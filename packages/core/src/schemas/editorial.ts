import { z } from "zod";

/**
 * ADR-0004 amendment #6 / ADR-0025 §5: a user-supplied quote (text
 * platforms, ADR-0002) on a named-person claim is `unverified` until an
 * editor confirms it against the original post/embed at the cited
 * timestamp. `not_applicable` covers claims that never carry a
 * submitter quote (e.g. the claim text itself is the submission).
 */
export const AttributionSchema = z.enum(["unverified", "confirmed", "not_applicable"]);
export type Attribution = z.infer<typeof AttributionSchema>;

/**
 * ADR-0025 §2/§6: an editor's disposition on a draft check. `correct`
 * is always additive (never overwrites the prior verdict row — AT-0025-4).
 */
export const ReviewActionTypeSchema = z.enum(["approve", "correct", "reject"]);
export type ReviewActionType = z.infer<typeof ReviewActionTypeSchema>;

export const ReviewActionSchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  actorId: z.string().uuid(),
  action: ReviewActionTypeSchema,
  notes: z.string().max(4000).nullable(),
  /** Required (and audit-logged) for an urgent public-safety publish that skips right-of-reply (AT-0025-3). */
  publicSafetyReason: z.string().min(1).max(2000).nullable(),
  createdAt: z.string().datetime(),
});
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

/**
 * ADR-0025 §4: right-of-reply workflow for a named-person draft. The
 * 48h clock starts at `contactAttemptAt`, not at draft creation.
 */
export const RightOfReplyStatusSchema = z.enum(["pending", "replied", "expired"]);
export type RightOfReplyStatus = z.infer<typeof RightOfReplyStatusSchema>;

export const RightOfReplySchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  namedPerson: z.string().min(1).max(500),
  contactChannel: z.string().min(1).max(200).nullable(),
  contactAttemptAt: z.string().datetime().nullable(),
  windowExpiresAt: z.string().datetime().nullable(),
  replyReceivedAt: z.string().datetime().nullable(),
  replyText: z.string().max(10_000).nullable(),
  status: RightOfReplyStatusSchema,
  createdAt: z.string().datetime(),
});
export type RightOfReply = z.infer<typeof RightOfReplySchema>;

export const EditorQueueItemSchema = z.object({
  checkId: z.string().uuid(),
  submissionId: z.string().uuid(),
  summary: z.string(),
  rating: z.enum(["True", "MostlyTrue", "Misleading", "False", "Unproven", "NotCheckable"]).nullable(),
  namedPersonClaims: z.array(
    z.object({ claimId: z.string().uuid(), text: z.string(), attribution: AttributionSchema }),
  ),
  createdAt: z.string().datetime(),
});
export type EditorQueueItem = z.infer<typeof EditorQueueItemSchema>;
