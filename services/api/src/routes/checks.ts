import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@fact-checker-ke/db";
import type { CheckRepository } from "../repositories/types.js";
import { NO_STORE_CACHE_CONTROL, PUBLISHED_CHECK_CACHE_CONTROL, publishedCheckEtag } from "../lib/cache-headers.js";
import { hashDeviceToken } from "../lib/device-token.js";
import { captureUserSignal } from "../lib/flywheel.js";

const SignalBodySchema = z.object({
  signal: z.enum(["agree", "dispute"]),
  reason: z.string().max(2000).nullable().optional(),
});

function deviceToken(request: { headers: Record<string, unknown> }): string | null {
  const header = (request.headers as Record<string, string | string[] | undefined>)["x-device-token"];
  return Array.isArray(header) ? (header[0] ?? null) : (header ?? null);
}

export async function checkRoutes(
  app: FastifyInstance,
  deps: { checks: CheckRepository; db?: Database | null },
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
}
