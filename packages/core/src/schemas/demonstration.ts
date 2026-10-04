import { z } from "zod";

export const DemonstrationStatusSchema = z.enum([
  "rumoured",
  "announced",
  "confirmed",
  "ongoing",
  "ended",
  "cancelled",
]);
export type DemonstrationStatus = z.infer<typeof DemonstrationStatusSchema>;

/**
 * A maandamano (protest) advisory entry. Deliberately coarse-grained:
 * `area` is a ward / sub-county name, never a coordinate pair or precise
 * address, so the advisory cannot be used to pinpoint individuals.
 */
export const DemonstrationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  area: z.string().min(1).max(200),
  county: z.string().min(1).max(100),
  status: DemonstrationStatusSchema,
  date: z.string().date().nullable(),
  summary: z.string().min(1).max(2000),
  sourceUrl: z.string().url().nullable(),
  updatedAt: z.string().datetime(),
});
export type Demonstration = z.infer<typeof DemonstrationSchema>;

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A): the public `GET
 * /v1/maandamano` response shape. `frozen: true` means the kill switch
 * is ON and `demonstrations` is ALWAYS `[]` in that case — the server
 * never sends live advisory rows alongside `frozen: true` (see
 * services/api/src/lib/maandamano.ts#getMaandamanoAdvisories). A reader
 * cannot distinguish "frozen" from "no advisories right now" by probing
 * the array; that's intentional — `frozen` is the only signal consumers
 * should branch on, and the array carries no information while frozen.
 */
export const MaandamanoResponseSchema = z.object({
  frozen: z.boolean(),
  demonstrations: z.array(DemonstrationSchema),
});
export type MaandamanoResponse = z.infer<typeof MaandamanoResponseSchema>;
