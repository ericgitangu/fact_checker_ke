import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { OutboxEventSchema, SubmissionStatusSchema } from "@fact-checker-ke/core";
import { schema, type Database } from "@fact-checker-ke/db";
import type { Publisher } from "../lib/publisher.js";
import type { PubSub } from "../lib/pubsub.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";
import { drainOutbox, cleanupExpiredIdempotencyKeys, publishOutboxRowInline } from "../lib/outbox.js";
import { advanceWithInbox } from "../lib/advance.js";

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
  verifier: SignatureVerifier;
  isProduction: boolean;
}

async function verifyOrReject(
  request: FastifyRequest,
  reply: FastifyReply,
  verifier: SignatureVerifier,
): Promise<boolean> {
  const signature = request.headers["upstash-signature"];
  const sig = Array.isArray(signature) ? signature[0] : signature;
  const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
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

    return reply.status(200).send({
      drained: drainResult.drained,
      failed: drainResult.failed,
      idempotencyKeysCleaned,
    });
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
