import { z } from "zod";
import { RatingSchema } from "./rating.js";
import { ClaimSchema } from "./claim.js";
import { SourceSchema } from "./source.js";

/**
 * A Check is the user-facing unit of work: one submission produces one or
 * more Checks (one per extracted claim group), each with a draft verdict
 * that a human reviewer must approve before `publishedAt` is set.
 */
export const CheckSchema = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  summary: z.string().min(1).max(4000),
  rating: RatingSchema.nullable(),
  claims: z.array(ClaimSchema),
  sources: z.array(SourceSchema),
  isDraft: z.boolean(),
  reviewedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
});
export type Check = z.infer<typeof CheckSchema>;
