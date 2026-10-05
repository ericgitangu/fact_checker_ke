import { z } from "zod";
import { RatingSchema } from "./rating.js";
import { RiskTierSchema } from "./guidance.js";
import { CredibilityTierSchema } from "./source.js";

/**
 * ADR-0032: which engine produced the submission a published Check traces
 * back to — "fetch" (the autonomous engine) or "submission" (a reader).
 * Mirrors `packages/db/src/schema.ts`'s `ingestSourceEnum` exactly; kept
 * as its own tiny schema here (rather than threaded onto the existing
 * `CheckSchema`, which several call sites construct as hand-written
 * literals) so this feed read-model is additive and doesn't force every
 * existing `Check` literal in the codebase to grow a new required field.
 */
export const IngestSourceSchema = z.enum(["submission", "fetch"]);
export type IngestSource = z.infer<typeof IngestSourceSchema>;

/**
 * One cited source on a feed item, with the quoted span inlined (the
 * `check_evidence` <-> `sources` join services/api's feed repository does
 * server-side — see services/api/src/repositories/postgres.ts
 * `listPublished`). Unlike `EvidenceItemSchema` (which only carries
 * `sourceId` and expects the caller to cross-reference a separate
 * `sources[]` array on the full `Check`), the feed is a flat, cheap-to-
 * render list view, so the join is pre-resolved.
 */
export const FeedCitedSourceSchema = z.object({
  sourceId: z.string().uuid(),
  quote: z.string().min(1).max(2000),
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  credibilityTier: CredibilityTierSchema,
});
export type FeedCitedSource = z.infer<typeof FeedCitedSourceSchema>;

/**
 * ADR-0032's visible payoff: one row in the "what we're checking now"
 * feed. A deliberately narrow, read-only projection of a PUBLISHED Check
 * (`isDraft=false AND published_at IS NOT NULL` — see
 * `services/api/src/routes/feed.ts`) — never a draft, which has nothing
 * publishable yet and (AT-0004-A/B) may still be under named-person
 * redaction.
 */
export const FeedItemSchema = z.object({
  id: z.string().uuid(),
  /** The claim under examination (`checks.summary`) — claim-attributed, never a person-indicting headline. */
  claim: z.string().min(1).max(4000),
  rating: RatingSchema,
  /** Measured-calibrated P(correct) — ADR-0031 hard constraint 1. Nullable defensively; a published row should always carry one. */
  calibratedConfidence: z.number().min(0).max(1).nullable(),
  ingestSource: IngestSourceSchema,
  riskTier: RiskTierSchema.nullable(),
  whatWouldChangeThis: z.string().nullable(),
  /** ADR-0034: the reader-facing context that leads the card (what the claim
   * asserts, how it misleads, the actual context). Nullable defensively. */
  context: z.string().nullable(),
  sources: z.array(FeedCitedSourceSchema),
  publishedAt: z.string().datetime(),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const FeedResponseSchema = z.object({
  items: z.array(FeedItemSchema),
  /** Opaque keyset cursor (the oldest item's `publishedAt` in this page) — pass back as `?cursor=` for the next page. `null` means no more pages. */
  nextCursor: z.string().datetime().nullable(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;
