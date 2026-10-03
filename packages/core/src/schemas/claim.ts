import { z } from "zod";
import { ClaimTypeSchema } from "./rating.js";
import { AttributionSchema } from "./editorial.js";

export const ClaimSchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  text: z.string().min(1).max(2000),
  claimType: ClaimTypeSchema,
  /** Position in the source transcript/text, for UI highlighting. */
  spanStart: z.number().int().nonnegative().nullable(),
  spanEnd: z.number().int().nonnegative().nullable(),
  /** ADR-0004/0025: does this claim name a specific person? Gates rating/attribution visibility. */
  namedPerson: z.boolean(),
  /** ADR-0004 amendment #6: a submitter-supplied quote's confirmation state. */
  attribution: AttributionSchema,
  createdAt: z.string().datetime(),
});
export type Claim = z.infer<typeof ClaimSchema>;
