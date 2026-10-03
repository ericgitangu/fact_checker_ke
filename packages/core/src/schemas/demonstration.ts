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
