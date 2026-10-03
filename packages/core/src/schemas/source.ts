import { z } from "zod";

/**
 * Credibility tier for a cited source, used to weight retrieval and to
 * surface a trust signal in the UI. Tier 1 = highest credibility
 * (e.g. primary government data, peer-reviewed research).
 */
export const CredibilityTierSchema = z.enum([
  "tier1_primary",
  "tier2_established_media",
  "tier3_general",
  "tier4_unverified",
]);
export type CredibilityTier = z.infer<typeof CredibilityTierSchema>;

export const SourceSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  credibilityTier: CredibilityTierSchema,
  publishedAt: z.string().datetime().optional(),
  retrievedAt: z.string().datetime(),
  excerpt: z.string().min(1).max(2000).optional(),
});
export type Source = z.infer<typeof SourceSchema>;
