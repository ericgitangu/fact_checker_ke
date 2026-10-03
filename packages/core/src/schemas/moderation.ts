import { z } from "zod";

/**
 * ADR-0024 §2/§3: `pending` = held by the pre-publish filter or by
 * report-threshold auto-hide, visible to its author only; `visible` =
 * publicly shown; `hidden`/`rejected` are editor/moderator dispositions.
 */
export const CommentStatusSchema = z.enum(["visible", "pending", "hidden", "rejected"]);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

export const CommentSchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  authorDeviceHash: z.string(),
  body: z.string().min(1).max(2000),
  status: CommentStatusSchema,
  reportCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Comment = z.infer<typeof CommentSchema>;

/**
 * ADR-0024 §2: pluggable scorer interface. The shipped implementation
 * (`services/api/src/lib/moderation-filter.ts`) is a fake
 * keyword/pattern scorer — no billable external moderation API call,
 * per the task's hard "no billable/external calls" rule. A real ML
 * scorer can be swapped in later behind this exact interface.
 */
export interface ObjectionableContentScorer {
  score(text: string): Promise<{ flagged: boolean; reasons: string[] }>;
}
