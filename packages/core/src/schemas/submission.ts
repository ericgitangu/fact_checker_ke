import { z } from "zod";

/**
 * Inbound submission from a user: either a URL to a piece of media/content,
 * or raw pasted text. Exactly one of `url` / `text` must be present —
 * enforced with a refine rather than a discriminated union so the API can
 * return one coherent validation error shape.
 */
export const SubmissionInputSchema = z
  .object({
    url: z.string().url().optional(),
    text: z.string().min(1).max(20_000).optional(),
    /**
     * ADR-0002 (accepted): for third-party video URLs we never download audio.
     * The submitter pastes the exact quote and where it occurs; we check that text.
     */
    quote: z.string().min(1).max(5_000).optional(),
    timestampSec: z.number().int().nonnegative().max(86_400).optional(),
    submittedBy: z.string().min(1).max(200).optional(),
  })
  .refine((data) => Boolean(data.url) !== Boolean(data.text), {
    message: "Provide exactly one of `url` or `text`.",
    path: ["url"],
  })
  .refine((data) => !(data.text && (data.quote || data.timestampSec !== undefined)), {
    message: "`quote`/`timestampSec` only apply to `url` submissions.",
    path: ["quote"],
  });
export type SubmissionInput = z.infer<typeof SubmissionInputSchema>;

/**
 * ADR-0017 state machine: received -> analyzing -> analyzed -> verifying
 * -> ready | failed. This is the single source of truth for the status
 * enum; packages/db's pgEnum derives from `.options` (see
 * packages/db/src/schema.ts) so there is exactly one place that can add
 * or rename a status.
 *
 * "processing" (the pre-ADR-0017 value) is retired in favour of the two
 * named hops so a conditional `UPDATE ... WHERE status=$expected` can
 * target a specific hop rather than a catch-all bucket (ADR-0017 S3).
 */
export const SubmissionStatusSchema = z.enum([
  "received",
  "analyzing",
  "analyzed",
  "verifying",
  "ready",
  "failed",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

/**
 * The ADR-0017 state machine's valid hops, as an adjacency map. Used by
 * the conditional-update helper (services/api/src/lib/state-machine.ts)
 * to reject an invalid transition before it ever reaches a WHERE clause,
 * and by tests asserting the machine's shape matches the ADR.
 */
export const SUBMISSION_STATUS_TRANSITIONS: Readonly<
  Record<SubmissionStatus, readonly SubmissionStatus[]>
> = {
  received: ["analyzing", "failed"],
  analyzing: ["analyzed", "failed"],
  analyzed: ["verifying", "failed"],
  verifying: ["ready", "failed"],
  ready: [],
  failed: [],
};

export const SubmissionSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url().nullable(),
  text: z.string().nullable(),
  submittedBy: z.string().nullable(),
  status: SubmissionStatusSchema,
  createdAt: z.string().datetime(),
  // ADR-0018: the polling ETag is derived from (status, updatedAt) --
  // see services/api/src/lib/cache-headers.ts.
  updatedAt: z.string().datetime(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

/**
 * Response shape for `GET /v1/submissions/:id` — the base submission plus
 * a pointer to its resulting check. Additive: `SubmissionSchema` itself is
 * unchanged, so every other consumer is unaffected.
 *
 * `checkId` is the REAL check id (distinct from the submission id — the
 * tracker previously, wrongly, linked to `/checks/{submissionId}`), or
 * null while no check exists yet (in-flight, or a `failed` dead-end).
 * `checkPublished` is false while the check is a draft held for editor
 * review and true once it is public — so the UI can link to the published
 * assessment vs. show a "held for review" state without leaking the draft.
 */
export const SubmissionStatusResponseSchema = SubmissionSchema.extend({
  checkId: z.string().uuid().nullable(),
  checkPublished: z.boolean(),
});
export type SubmissionStatusResponse = z.infer<typeof SubmissionStatusResponseSchema>;
