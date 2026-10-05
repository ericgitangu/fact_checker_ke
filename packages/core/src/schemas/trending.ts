import { z } from "zod";
import { IngestSourceSchema } from "./feed.js";

/**
 * "Trending / under review" stream (ADR-0032 refinement). The autonomous
 * fetch engine surfaces viral Kenyan videos, but a fresh/breaking viral has
 * no pre-existing fact-check evidence, so it is correctly HELD for the editor
 * rather than auto-published — which made the discovery invisible to readers.
 * This read-model surfaces the DISCOVERED items themselves (the viral video +
 * its engagement + a derived status), so "we catch what's trending" is visible
 * immediately, regardless of publish status.
 *
 * It is NOT the published feed (see feed.ts): a trending item is a
 * fetch-sourced `submissions` row, which may have NO published check yet. It
 * deliberately exposes ONLY the discovered video's own metadata plus a derived
 * status — NEVER a held draft check's rating/summary/verdict (decision C: the
 * editor queue and publish/evidence guards are untouched, and a draft's
 * content is not public).
 */

/**
 * Derived lifecycle status of a discovered item, computed from the owning
 * submission's status and whether it has its own check (see
 * services/api/src/lib/trending-status.ts `deriveTrendingStatus`):
 * - `monitoring`    — the pipeline is still assessing it (submission
 *   received/analyzing/analyzed/verifying, or `ready` with no check of its
 *   own yet, e.g. deduped to an already-published claim).
 * - `under_review`  — a human editor is assessing it: a HELD DRAFT check
 *   exists (NOT a verdict — no rating is exposed).
 * - `published`     — a published check exists; `checkId` links to it.
 * - `dismissed`     — the pipeline failed/dropped it (submission `failed`).
 */
export const TrendingStatusSchema = z.enum(["monitoring", "under_review", "published", "dismissed"]);
export type TrendingStatus = z.infer<typeof TrendingStatusSchema>;

/**
 * Raw engagement counts observed at ingestion. Nullable (a source may return
 * no counts); the client shows them as reach context, never as a ranking the
 * reader has to interpret.
 */
export const TrendingEngagementSchema = z.object({
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
});
export type TrendingEngagement = z.infer<typeof TrendingEngagementSchema>;

export const TrendingItemSchema = z.object({
  /** The owning `submissions` row id (the discovery), NOT a check id. */
  submissionId: z.string().uuid(),
  /** The discovered claim/video title (the fetch submission's `text`). */
  title: z.string().min(1),
  /** Source platform, e.g. "youtube". Nullable for historical rows. */
  platform: z.string().nullable(),
  /** The discovered VIDEO link (the submissions `source_url` column). */
  sourceUrl: z.string().url().nullable(),
  /** Log-weighted virality score; null sorts last (never treated as 0). */
  viralityScore: z.number().nonnegative().nullable(),
  engagement: TrendingEngagementSchema.nullable(),
  /** Always "fetch" for trending items (the stream is fetch-sourced). */
  ingestSource: IngestSourceSchema,
  status: TrendingStatusSchema,
  /** The published check's id when `status === "published"`, else null. A
   * DRAFT's id is never exposed — only a published check is linkable. */
  checkId: z.string().uuid().nullable(),
  /** When the fetch engine observed the item (submission `created_at`). */
  observedAt: z.string().datetime(),
  /** When a resulting check was published, else null. */
  publishedAt: z.string().datetime().nullable(),
});
export type TrendingItem = z.infer<typeof TrendingItemSchema>;

export const TrendingResponseSchema = z.object({
  /**
   * Discovered items ordered by `viralityScore` DESC NULLS LAST (ties broken
   * by `observedAt` DESC). Capped by the endpoint's limit; the stream is a
   * "what's trending right now" snapshot, not a deep paginated archive, so
   * there is no cursor — a reader who wants the published archive uses
   * `GET /v1/feed`.
   */
  items: z.array(TrendingItemSchema),
});
export type TrendingResponse = z.infer<typeof TrendingResponseSchema>;
