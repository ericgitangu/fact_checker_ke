import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { OutboxEventSchema, SubmissionStatusSchema } from "@fact-checker-ke/core";
import { schema, type Database } from "@fact-checker-ke/db";
import type { Publisher } from "../lib/publisher.js";
import type { PubSub } from "../lib/pubsub.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";
import { drainOutbox, cleanupExpiredIdempotencyKeys, publishOutboxRowInline } from "../lib/outbox.js";
import { advanceWithInbox } from "../lib/advance.js";
import { runRetentionSweep } from "../lib/retention.js";
import { runEntitlementSweep } from "../lib/entitlement-sweep.js";
import { runSubmissionOrchestration } from "../lib/submission-orchestrator.js";
import { sweepExpiredLifecycle } from "../lib/editorial.js";
import type { EntitlementRepository } from "../repositories/types.js";

const SubmissionAdvancedBodySchema = z.object({
  messageId: z.string().min(1),
  submissionId: z.string().uuid(),
  from: SubmissionStatusSchema,
  to: SubmissionStatusSchema,
  event: OutboxEventSchema.nullable().optional(),
});

export interface InternalRoutesDeps {
  db: Database | null;
  publisher: Publisher;
  pubsub: PubSub;
  analyzeHopUrl: string;
  /**
   * ADR-0032/0017 "C1 gap" closer: base URL of services/pipeline itself,
   * called directly by `/internal/hops/orchestrate` (see
   * lib/submission-orchestrator.ts). Optional + defaulted so existing
   * tests constructing `InternalRoutesDeps` literally (predating this
   * route) keep compiling unchanged.
   */
  pipelineBaseUrl?: string;
  verifier: SignatureVerifier;
  isProduction: boolean;
  /**
   * ADR-0012 §3 (monetization v2): the entitlement repository, used by the
   * expiry sweeper (`/internal/entitlements/sweep` and the piggyback on
   * `/internal/outbox/drain`). Optional + defaulted so existing tests that
   * construct `InternalRoutesDeps` literally (predating this field) keep
   * compiling; when omitted the sweeper is a no-op (0 rows), same
   * fail-safe spirit as the `db`-gated branches below.
   */
  entitlements?: EntitlementRepository;
  /**
   * ADR-0038 (FEATURE_PRELIMINARY_THREADS): forwarded to the submission
   * orchestrator so it only trusts/persists the verify-hop lifecycle fields
   * when on. Optional + defaulted off so existing `InternalRoutesDeps` literals
   * keep compiling and the lifecycle work stays dark until flipped on.
   */
  featurePreliminaryThreads?: boolean;
  /** ADR-0038 (FEATURE_LIFECYCLE_EXPIRY): gates POST /internal/lifecycle/expire.
   * Off/omitted ⇒ the sweep is a no-op. */
  featureLifecycleExpiry?: boolean;
  /** ADR-0038: TTLs (days) for the expiry sweep; defaulted to 7 / 30. */
  lifecycleExpiryDays?: number;
  editorReviewExpiryDays?: number;
}

async function verifyOrReject(
  request: FastifyRequest,
  reply: FastifyReply,
  verifier: SignatureVerifier,
): Promise<boolean> {
  const signature = request.headers["upstash-signature"];
  const sig = Array.isArray(signature) ? signature[0] : signature;
  // Prefer the exact bytes captured by the raw-body content-type parser
  // (app.ts); fall back to re-stringifying only when it's absent (e.g. unit
  // tests that inject a parsed body). request.protocol/hostname are now
  // proxy-aware (trustProxy: true), so this reconstructs the https:// URL
  // QStash actually signed (ADR-0017).
  const rawBody =
    (request as unknown as { rawBody?: string }).rawBody ??
    (typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}));
  const url = `${request.protocol}://${request.hostname}${request.url}`;
  const ok = await verifier.verify({ signature: sig, body: rawBody, url });
  if (!ok) {
    await reply.status(401).send({ error: "invalid_signature" });
    return false;
  }
  return true;
}

/**
 * ADR-0017 §1/§4/§5: internal endpoints called by QStash (the sweeper
 * schedule, and the pipeline's hop-completion callback), protected by
 * QStash signature verification rather than a session (ADR-0015
 * "public ingress plus signature verification").
 */
export async function internalRoutes(app: FastifyInstance, deps: InternalRoutesDeps): Promise<void> {
  app.post("/internal/outbox/drain", async (request, reply) => {
    if (!(await verifyOrReject(request, reply, deps.verifier))) return;
    if (!deps.db) {
      return reply.status(503).send({ error: "db_unavailable" });
    }

    const drainResult = await drainOutbox(deps.db, deps.publisher, deps.analyzeHopUrl);
    const idempotencyKeysCleaned = await cleanupExpiredIdempotencyKeys(deps.db);
    // ADR-0021: the retention sweep piggybacks on the EXISTING sweeper
    // endpoint rather than a new cron (task brief's explicit
    // instruction) -- see services/api/src/lib/retention.ts.
    const retention = await runRetentionSweep(deps.db);
    // ADR-0012 §3 (monetization v2): the entitlement expiry sweep rides the
    // SAME existing sweeper (same ADR-0021 piggyback pattern) so lapsed
    // `active` rows get their durable `expired` label without a new cron.
    // No-op when the entitlement repo isn't wired (older test deps).
    const entitlementsExpired = deps.entitlements ? (await runEntitlementSweep(deps.entitlements)).expired : 0;

    return reply.status(200).send({
      drained: drainResult.drained,
      failed: drainResult.failed,
      idempotencyKeysCleaned,
      retention,
      entitlementsExpired,
    });
  });

  // ADR-0012 §3 (monetization v2): a dedicated, independently-schedulable
  // entitlement expiry sweep. Same QStash signature verification as every
  // other /internal route (fail-closed when no signing keys are set). It
  // needs NO database branch of its own — it goes through the entitlement
  // REPOSITORY (which is backed by Postgres or the in-memory double exactly
  // like the read/webhook paths), so it works in local dev too; a missing
  // repo (older wiring) is a safe no-op rather than a 503.
  app.post("/internal/entitlements/sweep", async (request, reply) => {
    if (!(await verifyOrReject(request, reply, deps.verifier))) return;
    if (!deps.entitlements) {
      return reply.status(200).send({ expired: 0, note: "entitlement repository not wired; no-op" });
    }
    const result = await runEntitlementSweep(deps.entitlements);
    return reply.status(200).send(result);
  });

  // ADR-0038 auto-expire sweep ([T]): Cloud-Scheduler-driven (scale-to-zero,
  // no always-on worker — the schedule is created out-of-band, same policy as
  // the outbox/retention sweeps), transitioning stale non-terminal checks to
  // `archived_expired`. Same QStash signature verification as every other
  // /internal route (fail-closed when no signing keys are set) and the same
  // db-gated 503 as the drain route (it writes checks + audit_log, which the
  // in-memory mode has no store for). FLAG-GATED on FEATURE_LIFECYCLE_EXPIRY:
  // off ⇒ an authenticated no-op (the ADR-0038 rollback path).
  app.post("/internal/lifecycle/expire", async (request, reply) => {
    if (!(await verifyOrReject(request, reply, deps.verifier))) return;
    if (!deps.featureLifecycleExpiry) {
      return reply.status(200).send({ archived: 0, note: "FEATURE_LIFECYCLE_EXPIRY off; no-op" });
    }
    if (!deps.db) {
      return reply.status(503).send({ error: "db_unavailable" });
    }
    const result = await sweepExpiredLifecycle(deps.db, {
      lifecycleExpiryDays: deps.lifecycleExpiryDays ?? 7,
      editorReviewExpiryDays: deps.editorReviewExpiryDays ?? 30,
    });
    return reply.status(200).send(result);
  });

  app.post("/internal/events/submission-advanced", async (request, reply) => {
    if (!(await verifyOrReject(request, reply, deps.verifier))) return;
    if (!deps.db) {
      return reply.status(503).send({ error: "db_unavailable" });
    }

    const parsed = SubmissionAdvancedBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const body = parsed.data;

    const result = await advanceWithInbox(deps.db, {
      messageId: body.messageId,
      handler: "submission-advanced",
      submissionId: body.submissionId,
      from: body.from,
      to: body.to,
      event: body.event ?? null,
    });

    if (result.outcome === "duplicate_message") {
      return reply.status(200).send({ outcome: "duplicate_message_acked" });
    }
    if (result.outcome === "invalid_transition") {
      return reply.status(422).send({ outcome: "invalid_transition" });
    }
    if (result.outcome === "stale_or_duplicate") {
      // ADR-0017 §3: zero rows updated -> ack and stop, not an error.
      return reply.status(200).send({ outcome: "stale_or_duplicate_acked" });
    }

    // Publish the compact SSE message to Redis AFTER commit (ADR-0018
    // §SSE point 1) — `result` above already reflects a committed tx.
    await deps.pubsub
      .publish(
        `sub:${body.submissionId}`,
        JSON.stringify({
          event_id: result.event?.event_id ?? null,
          status: body.to,
          at: new Date().toISOString(),
        }),
      )
      .catch(() => {
        // Pub/sub is at-most-once by design (ADR-0018 trade-off); a
        // failure here never fails the request — Postgres replay on
        // (re)connect covers it.
      });

    if (result.outboxRowId) {
      await publishOutboxRowInline(deps.db, deps.publisher, deps.analyzeHopUrl, result.outboxRowId).catch(() => {});
    }

    return reply.status(200).send({ outcome: "advanced" });
  });

  // ADR-0032/0017 "C1 gap" closer: the outbox relay's new target (see
  // app.ts's `orchestrationHopUrl` wiring, which REPLACES the old
  // "publish straight to the pipeline" default). Every outbox row --
  // not only `submission.received` -- lands here now (the relay has
  // always had exactly one target URL per `drainOutbox`/
  // `publishOutboxRowInline` call); every OTHER event type is acked as
  // a no-op (there is nothing further for this route to do for a
  // `check.published`/`check.corrected`/`fetch.*` row -- its own
  // producer already did everything required).
  app.post("/internal/hops/orchestrate", async (request, reply) => {
    if (!(await verifyOrReject(request, reply, deps.verifier))) return;
    if (!deps.db) {
      return reply.status(503).send({ error: "db_unavailable" });
    }

    const parsed = OutboxEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const event = parsed.data;

    if (event.event_type !== "submission.received") {
      return reply.status(200).send({ outcome: "ignored_non_submission_received", eventType: event.event_type });
    }

    // Idempotency (retry safety, 1c): orchestration is a multi-step,
    // NON-transactional flow (two pipeline HTTP calls + several inserts +
    // enactment), so a QStash retry of a delivery that already succeeded would
    // otherwise re-run analyze+verify and insert a SECOND published check.
    // Claim the event in the ADR-0017 inbox (`processed_messages`, handler
    // "orchestrate") up front: a duplicate delivery of an already-processed
    // event is acked as a no-op. Because the work is not transactional, a
    // FAILED run RELEASES the claim (delete) so QStash's retry genuinely
    // re-drives it — the claim means "already succeeded", never "already
    // attempted". (Same-message concurrent redelivery is not a real QStash
    // behaviour; the small release/win race it would imply is acceptable and
    // flagged here rather than hidden.)
    const ORCHESTRATE_HANDLER = "orchestrate";
    const claimed = await deps.db
      .insert(schema.processedMessages)
      .values({ messageId: event.event_id, handler: ORCHESTRATE_HANDLER })
      .onConflictDoNothing({
        target: [schema.processedMessages.messageId, schema.processedMessages.handler],
      })
      .returning({ messageId: schema.processedMessages.messageId });
    if (claimed.length === 0) {
      return reply.status(200).send({ outcome: "duplicate_message_acked" });
    }

    try {
      const outcome = await runSubmissionOrchestration({
        db: deps.db,
        pipelineBaseUrl: deps.pipelineBaseUrl ?? "http://localhost:8000",
        event,
        // ADR-0038 contract A: only persist the verify-hop lifecycle fields
        // when the flag is on (otherwise ship dark).
        featurePreliminaryThreads: deps.featurePreliminaryThreads ?? false,
      });
      return reply.status(200).send({ outcome: outcome.kind, ...outcome });
    } catch (err) {
      // Release the inbox claim so the retry re-runs (the run did NOT succeed).
      await deps.db
        .delete(schema.processedMessages)
        .where(
          and(
            eq(schema.processedMessages.messageId, event.event_id),
            eq(schema.processedMessages.handler, ORCHESTRATE_HANDLER),
          ),
        )
        .catch(() => {
          // A failed release just means the retry is acked as a duplicate
          // instead of re-running — surfaced via the 500 + log below, not
          // silently swallowed into a success.
        });
      // Propagate as a 5xx (unlike the producer-side relay's own
      // swallowed-failure convention) so QStash retries this delivery —
      // this route is the CONSUMER of record for submission.received;
      // nothing else will ever re-drive this event if it's dropped here.
      request.log.error({ err, submissionId: event.submission_id }, "submission orchestration failed");
      return reply.status(500).send({ error: "orchestration_failed" });
    }
  });

  // Dev-only simulator (task brief §5): drives a submission through the
  // hops via the REAL handler code path (`advanceWithInbox`, same as
  // the signature-verified route above), never NODE_ENV=production.
  if (!deps.isProduction) {
    app.post("/internal/dev/simulate", async (request, reply) => {
      if (!deps.db) {
        return reply.status(503).send({ error: "db_unavailable" });
      }
      const parsed = z.object({ submissionId: z.string().uuid() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const { submissionId } = parsed.data;

      const [submissionRow] = await deps.db
        .select({ orgId: schema.submissions.orgId })
        .from(schema.submissions)
        .where(eq(schema.submissions.id, submissionId));
      if (!submissionRow) {
        return reply.status(404).send({ error: "not_found" });
      }
      const orgId = submissionRow.orgId;

      // Two of the four hops carry a REAL, schema-validated event (not
      // just a state marker) so this dev path exercises the full
      // submission_events + id-bearing-SSE-forward code paths, not
      // only the conditional UPDATE — the ids/payloads are synthetic
      // (no real pipeline ran), which is exactly what a dev-only
      // simulator is for.
      const hops: Array<{
        from: z.infer<typeof SubmissionStatusSchema>;
        to: z.infer<typeof SubmissionStatusSchema>;
        event: unknown | null;
      }> = [
        { from: "received", to: "analyzing", event: null },
        {
          from: "analyzing",
          to: "analyzed",
          event: {
            event_id: randomUUID(),
            occurred_at: new Date().toISOString(),
            submission_id: submissionId,
            org_id: orgId,
            event_type: "submission.analyzed",
            schema_version: "v1",
            payload: { claim_count: 1 },
          },
        },
        { from: "analyzed", to: "verifying", event: null },
        {
          from: "verifying",
          to: "ready",
          event: {
            event_id: randomUUID(),
            occurred_at: new Date().toISOString(),
            submission_id: submissionId,
            org_id: orgId,
            event_type: "check.published",
            schema_version: "v1",
            payload: { check_id: randomUUID(), rating: "Unproven" },
          },
        },
      ];

      const outcomes = [];
      for (const hop of hops) {
        const event = hop.event ? OutboxEventSchema.parse(hop.event) : null;
        const result = await advanceWithInbox(deps.db, {
          messageId: `dev-sim-${submissionId}-${hop.to}`,
          handler: "submission-advanced",
          submissionId,
          from: hop.from,
          to: hop.to,
          event,
        });
        outcomes.push({ to: hop.to, outcome: result.outcome });
        if (result.outcome === "advanced") {
          await deps.pubsub
            .publish(
              `sub:${submissionId}`,
              JSON.stringify({ event_id: event?.event_id ?? null, status: hop.to, at: new Date().toISOString() }),
            )
            .catch(() => {});
        }
      }

      return reply.status(200).send({ outcomes });
    });
  }
}
