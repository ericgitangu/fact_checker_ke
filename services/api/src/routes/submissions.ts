import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SubmissionInputSchema } from "@fact-checker-ke/core";
import type { SubmissionRepository } from "../repositories/types.js";
import type { SubmissionService } from "../lib/submission-service.js";
import { hashRequestBody } from "../lib/idempotency.js";
import { submissionEtag, NO_STORE_CACHE_CONTROL } from "../lib/cache-headers.js";
import type { DeviceQuotaGuard } from "../lib/device-quota.js";
import { hashDeviceToken } from "../lib/device-token.js";

const IdempotencyKeySchema = z.string().uuid();

export async function submissionRoutes(
  app: FastifyInstance,
  deps: { submissions: SubmissionRepository; submissionService: SubmissionService; deviceQuotaGuard: DeviceQuotaGuard },
): Promise<void> {
  app.post("/v1/submissions", async (request, reply) => {
    // ADR-0020 §1/§7: the device token (from POST /v1/device) is
    // REQUIRED on submissions and is the quota key — never the bare IP
    // (CGNAT-safe, closes red-team C-9). Missing header -> 400, not a
    // silent IP-keyed fallback.
    const rawDeviceToken = request.headers["x-device-token"];
    const deviceToken = Array.isArray(rawDeviceToken) ? rawDeviceToken[0] : rawDeviceToken;
    if (!deviceToken) {
      return reply.status(400).send({
        error: "device_token_required",
        message: "The X-Device-Token header is required (see POST /v1/device).",
      });
    }

    const withinQuota = await deps.deviceQuotaGuard.checkAndConsume(deviceToken);
    if (!withinQuota) {
      return reply.status(429).send({ error: "device_quota_exceeded" });
    }

    // ADR-0017 §2: Idempotency-Key is REQUIRED on POST /v1/submissions.
    const rawKey = request.headers["idempotency-key"];
    const keyParse = IdempotencyKeySchema.safeParse(Array.isArray(rawKey) ? rawKey[0] : rawKey);
    if (!keyParse.success) {
      return reply.status(400).send({
        error: "idempotency_key_required",
        message: "The Idempotency-Key header is required and must be a UUID.",
      });
    }

    const parseResult = SubmissionInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "validation_error",
        issues: parseResult.error.issues,
      });
    }

    const input = parseResult.data;
    const submission = {
      url: input.url ?? null,
      text: input.text ?? null,
      submittedBy: input.submittedBy ?? null,
      quote: input.quote ?? null,
      timestampSec: input.timestampSec ?? null,
      // ADR-0021 AT-0021-4: not included in `requestHash` below —
      // deliberately excluded from the idempotency hash so re-sending
      // the exact same submission body with a different device token
      // (e.g. app reinstall) still matches the idempotency-key replay
      // path on content, not on device identity.
      deviceTokenHash: hashDeviceToken(deviceToken),
    };
    const requestHash = hashRequestBody({
      url: submission.url,
      text: submission.text,
      submittedBy: submission.submittedBy,
      quote: submission.quote,
      timestampSec: submission.timestampSec,
    });

    const outcome = await deps.submissionService.createWithIdempotency({
      idempotencyKey: keyParse.data,
      requestHash,
      submission,
    });

    reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);

    switch (outcome.kind) {
      case "created":
        return reply.status(outcome.status).send(outcome.body);
      case "replay":
        return reply.status(outcome.status).send(outcome.body);
      case "conflict":
        return reply.status(422).send({
          error: "idempotency_key_conflict",
          message: "This Idempotency-Key was already used with a different request body.",
        });
    }
  });

  app.get<{ Params: { id: string } }>("/v1/submissions/:id", async (request, reply) => {
    const result = await deps.submissions.getById(request.params.id);
    if (!result.ok) {
      return reply.status(404).send({ error: "not_found", message: result.error.message });
    }

    // ADR-0018: "Drafts and submissions are private, no-store" — but we
    // still compute an ETag so the fallback-polling path (ADR-0018
    // point 4) gets a cheap 304 even on a no-store resource; no-store
    // forbids a *shared* cache from storing the body, it does not
    // forbid the client's own conditional-GET revalidation.
    const etag = submissionEtag(result.value.status, result.value.updatedAt);
    reply.header("Cache-Control", NO_STORE_CACHE_CONTROL);
    reply.header("ETag", etag);

    const ifNoneMatch = request.headers["if-none-match"];
    if (ifNoneMatch === etag) {
      return reply.status(304).send();
    }

    return reply.status(200).send(result.value);
  });
}
