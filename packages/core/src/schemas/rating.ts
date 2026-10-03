import { z } from "zod";

/**
 * Verdict rating applied to a Claim after human review.
 * Mirrors the Google ClaimReview `reviewRating` vocabulary loosely — see
 * claim-review/builder.ts for the mapping to schema.org values.
 */
export const RatingSchema = z.enum([
  "True",
  "MostlyTrue",
  "Misleading",
  "False",
  "Unproven",
  "NotCheckable",
]);
export type Rating = z.infer<typeof RatingSchema>;

export const ClaimTypeSchema = z.enum([
  "checkable",
  "opinion",
  "prediction",
  "rhetoric",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
