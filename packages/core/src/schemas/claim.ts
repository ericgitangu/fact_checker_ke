import { z } from "zod";
import { ClaimTypeSchema } from "./rating.js";

export const ClaimSchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  text: z.string().min(1).max(2000),
  claimType: ClaimTypeSchema,
  /** Position in the source transcript/text, for UI highlighting. */
  spanStart: z.number().int().nonnegative().nullable(),
  spanEnd: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});
export type Claim = z.infer<typeof ClaimSchema>;
