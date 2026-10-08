import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@fact-checker-ke/db";
import type { CheckRepository } from "../repositories/types.js";
import { NO_STORE_CACHE_CONTROL, PUBLISHED_CHECK_CACHE_CONTROL, publishedCheckEtag } from "../lib/cache-headers.js";
import { hashDeviceToken } from "../lib/device-token.js";
import { captureUserSignal } from "../lib/flywheel.js";
import type { DeviceQuotaGuard } from "../lib/device-quota.js";
import type { Publisher } from "../lib/publisher.js";
import {
  submitClaimSource,
  resolveUrlServerSide,
  type ClaimSourceStore,
} from "../lib/claim-source.js";

const SignalBodySchema = z.object({
  signal: z.enum(["agree", "dispute"]),
  reason: z.string().max(2000).nullable().optional(),
});

// ADR-0038 Wave 2: a crowdsourced source submission. `url` must be a URL;
// `note` is optional reader context (≤2000, matching the table's intent).
const SourceSubmissionSchema = z.object({
  url: z.string().url(),
  note: z.string().max(2000).optional(),
});

export interface CheckRouteCrowdsourceDeps {
  /** The claim-source store (Postgres in prod). Null in in-memory mode → 501. */
  claimSourceStore: ClaimSourceStore | null;
  /** Reuses the SAME per-device daily throttle as POST /v1/submissions. */
  deviceQuotaGuard: DeviceQuotaGuard;
  /** QStash publisher for the re-verify enqueue (shared with the outbox relay). */
  publisher: Publisher;
  /** The pipeline verify-hop URL the re-verify is published to. */
  reverifyHopUrl: string;
  /** Accepted tier≤2 count at/above which a re-verify is enqueued. */
  reverifyThreshold: number;
  /** FEATURE_CROWDSOURCE_SOURCES — off ⇒ the endpoint 404s (rollback path). */
  featureCrowdsourceSources: boolean;
  /** Injectable fetch for server-side URL resolution (tests pass a fake). */
  fetchImpl?: typeof fetch;
}

function deviceToken(request: { headers: Record<string, unknown> }): string | null {
  const header = (request.headers as Record<string, string | string[] | undefined>)["x-device-token"];
  return Array.isArray(header) ? (header[0] ?? null) : (header ?? null);
}

export async function checkRoutes(
  app: FastifyInstance,
  deps: { checks: CheckRepository; db?: Database | null; crowdsource?: CheckRouteCrowdsourceDeps },
): Promise<void> {
  app.get<{ Params: { id: string } }>("/v1/checks/:id", async (request, reply) => {
    const result = await deps.checks.getById(request.params.id);
    if (!result.ok) {
      return reply.status(404).send({ error: "not_found", message: result.error.message });
    }

    const check = result.value;

    // AT-0004-A/AT-0004-B (ADR-0004 amendment #6 / ADR-0025 §5): a draft
    // naming a person is disclosure, not publication (ADR-0021) -- the
    // submitter sees evidence/sources only, `rating: null`, until an
    // editor confirms every named-person claim's quote attribution AND
    // approves (services/api/src/lib/editorial.ts#approveCheck flips
    // `isDraft` to false only after that gate clears). This redaction
    // applies to ANY draft with a named-person claim, not only an
    // unconfirmed one — the editor's approval (not just attribution
    // confirmation) is what makes a rating publishable at all.
    const hasNamedPersonClaim = check.claims.some((c) => c.namedPerson);
    const responseBody = check.isDraft && hasNamedPersonClaim ? { ...check, rating: null } : check;

    // ADR-0018 caching table: "Published checks only" get the shared,
    // long-lived cache entry; drafts are `private, no-store`. Version
    // is the check's `publishedAt` for now — a dedicated monotonic
    // version bump on `check.corrected` (ADR-0018 "Correction safety")
    // is tech debt: ADR-0008's correction workflow (which would write
    // that column) is a separate, not-yet-implemented ADR, and
    // apps/web's ISR tag-revalidation consumer (AT-0018-6) is out of
    // this change's ownership (apps/** is wave 3/4 territory).
    if (!check.isDraft && check.publishedAt) {
      const etag = publishedCheckEtag(check.id, Date.parse(check.publishedAt));
      reply.header("Cache-Control", PUBLISHED_CHECK_CACHE_CONTROL);
      reply.header("ETag", etag);
      const ifNoneMatch = request.headers["if-none-match"];
      if (ifNoneMatch === etag) {
        return reply.status(304).send();
      }
    } else {
      reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);
    }

    return reply.status(200).send(responseBody);
  });

  /**
   * ADR-0031 AT-0031-4: a reader's post-publish agree/dispute signal on a
   * published check, captured as a labeled flywheel row (packages/db's
   * `training_eval_labels` table) for the calibration/threshold re-fit
   * cadence (ADR-0031 "Review triggers"). Device-hash gated, same
   * accountability-without-account pattern as comment reporting
   * (routes/comments.ts) — never the raw device token.
   */
  app.post<{ Params: { id: string } }>("/v1/checks/:id/signal", async (request, reply) => {
    if (!deps.db) {
      // In-memory (no-DATABASE_URL) mode has no flywheel table to write
      // to -- an explicit, typed "not available" response rather than a
      // silent no-op that would look like success.
      return reply.status(501).send({ error: "flywheel_capture_unavailable", message: "No database configured." });
    }
    const parsed = SignalBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const token = deviceToken(request);
    if (!token) return reply.status(400).send({ error: "device_token_required" });

    const result = await captureUserSignal(deps.db, {
      checkId: request.params.id,
      deviceTokenHash: hashDeviceToken(token),
      signal: parsed.data.signal,
      reason: parsed.data.reason ?? null,
    });
    if (!result.ok) {
      return reply.status(404).send({ error: result.error.kind, message: result.error.message });
    }
    return reply.status(201).send(result.value);
  });

  /**
   * ADR-0038 Wave 2 "Submit the truth": a public, device-throttled,
   * URL-validated, deduped crowdsourced source submission for a check that is
   * in an OPEN thread (preliminary / awaiting_sources / editor_review). The URL
   * is resolved + tiered server-side; accepted tier≤2 sources count toward a
   * re-verify enqueue. No auth (same public posture as POST /v1/submissions);
   * the X-Device-Token header is the throttle key, hashed before storage.
   *
   * Flag-gated by FEATURE_CROWDSOURCE_SOURCES — OFF ⇒ 404 (ADR-0038 rollback
   * path: "endpoint 404s"). All the work lives in lib/claim-source.ts behind a
   * store port so this handler stays thin and the logic is unit-testable.
   */
  app.post<{ Params: { id: string } }>("/v1/checks/:id/sources", async (request, reply) => {
    const cs = deps.crowdsource;
    // Flag off (or not wired) ⇒ 404: the affordance degrades to today's inert
    // hint, and nothing leaks that the route exists.
    if (!cs || !cs.featureCrowdsourceSources) {
      return reply.status(404).send({ error: "not_found", message: "Not found." });
    }
    // No DB (in-memory dev/test with no DATABASE_URL) ⇒ the claim_source_submissions
    // table doesn't exist — an explicit typed "unavailable", not a silent success
    // (same convention as POST /v1/checks/:id/signal above).
    if (!cs.claimSourceStore) {
      return reply.status(501).send({ error: "crowdsource_unavailable", message: "No database configured." });
    }

    const token = deviceToken(request);
    if (!token) {
      return reply.status(400).send({
        error: "device_token_required",
        message: "The X-Device-Token header is required (see POST /v1/device).",
      });
    }

    // Same per-device daily throttle as POST /v1/submissions (ADR-0020 §7),
    // consuming one unit of the shared device quota.
    const withinQuota = await cs.deviceQuotaGuard.checkAndConsume(token);
    if (!withinQuota) {
      return reply.status(429).send({ error: "device_quota_exceeded" });
    }

    const parsed = SourceSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const result = await submitClaimSource(
      cs.claimSourceStore,
      {
        resolveUrl: (url) => resolveUrlServerSide(url, cs.fetchImpl ?? fetch),
        publisher: cs.publisher,
        reverifyHopUrl: cs.reverifyHopUrl,
        reverifyThreshold: cs.reverifyThreshold,
      },
      {
        checkId: request.params.id,
        url: parsed.data.url,
        note: parsed.data.note ?? null,
        deviceHash: hashDeviceToken(token),
      },
    );

    reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);
    if (!result.ok) {
      return reply.status(result.httpStatus).send({ error: result.error.code, message: result.error.message });
    }
    return reply.status(result.httpStatus).send(result.value);
  });

  /**
   * ADR-0038 Wave 2: the SAME crowdsource flow, keyed by SUBMISSION id. The
   * public trending stream exposes `submissionId` but deliberately never the
   * draft check id, so a reader on a trending (preliminary / awaiting_sources /
   * editor_review) item submits a source by submission id; we resolve it to the
   * owning check server-side and reuse submitClaimSource unchanged. Same flag,
   * throttle, validation, and lifecycle gating as /v1/checks/:id/sources.
   */
  app.post<{ Params: { id: string } }>("/v1/submissions/:id/sources", async (request, reply) => {
    const cs = deps.crowdsource;
    if (!cs || !cs.featureCrowdsourceSources) {
      return reply.status(404).send({ error: "not_found", message: "Not found." });
    }
    if (!cs.claimSourceStore) {
      return reply.status(501).send({ error: "crowdsource_unavailable", message: "No database configured." });
    }
    const token = deviceToken(request);
    if (!token) {
      return reply.status(400).send({
        error: "device_token_required",
        message: "The X-Device-Token header is required (see POST /v1/device).",
      });
    }
    const withinQuota = await cs.deviceQuotaGuard.checkAndConsume(token);
    if (!withinQuota) {
      return reply.status(429).send({ error: "device_quota_exceeded" });
    }
    const parsed = SourceSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    // Resolve the submission to its check; a fetch submission with no check yet
    // (or an unknown id) has no open thread to attach a source to.
    const checkId = await cs.claimSourceStore.resolveCheckIdBySubmission(request.params.id);
    if (!checkId) {
      return reply.status(404).send({ error: "not_found", message: "No check for this submission." });
    }
    const result = await submitClaimSource(
      cs.claimSourceStore,
      {
        resolveUrl: (url) => resolveUrlServerSide(url, cs.fetchImpl ?? fetch),
        publisher: cs.publisher,
        reverifyHopUrl: cs.reverifyHopUrl,
        reverifyThreshold: cs.reverifyThreshold,
      },
      { checkId, url: parsed.data.url, note: parsed.data.note ?? null, deviceHash: hashDeviceToken(token) },
    );
    reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);
    if (!result.ok) {
      return reply.status(result.httpStatus).send({ error: result.error.code, message: result.error.message });
    }
    return reply.status(result.httpStatus).send(result.value);
  });
}
