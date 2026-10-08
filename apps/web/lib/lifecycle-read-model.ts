import { z } from "zod";
import {
  CheckLifecycleSchema,
  FeedItemSchema,
  RatingSchema,
  TrendingItemSchema,
  type CheckLifecycle,
} from "@fact-checker-ke/core";

/**
 * ADR-0038 contract B (api → web), web side. services/api exposes three
 * additive editorial-lifecycle fields on the feed / trending read models, but
 * the core `ApiClient` zod-`.parse()`s responses and STRIPS unknown keys — and
 * `packages/core` is out of scope this wave, so the schemas there can't be
 * widened. So the web reads these fields with its OWN extended fetch+parse
 * (see get-feed.ts / get-trending.ts) instead of through `ApiClient`.
 *
 * All three fields are OPTIONAL here (not defaulted), so (a) a response from an
 * older API or the local mock fixture still validates and reads as a plain
 * published item (lifecycleState absent → the card renders the verdict as
 * today), and (b) a plain core `FeedItem`/`TrendingItem` literal — as the
 * existing component tests construct — is still assignable to the view type.
 */
export const LifecycleReadFieldsSchema = z.object({
  lifecycleState: CheckLifecycleSchema.nullable().optional(),
  authoritative: z.boolean().optional(),
  sourceKind: z.string().nullable().optional(),
});

/**
 * ADR-0038 Wave 3: the feed-item VIEW is WIDENED so ONE card renders both a
 * published verdict and an OPEN THREAD (`preliminary`/`awaiting_sources`). An
 * open thread forces three relaxations the published-only core `FeedItem`
 * cannot express — and packages/core is fenced this wave, so the widening lives
 * here (zod `.extend` overrides the inherited fields):
 *   - `rating` is NULLABLE (withheld for a named-person thread; the AI draft
 *     stance for a non-named preliminary; the verdict for a published item).
 *   - `publishedAt` is NULLABLE (an open thread has never published).
 *   - `createdAt` is carried and `sourceCount` is added (both optional, so a
 *     plain core `FeedItem` literal — and the legacy `/v1/feed` response, whose
 *     items always carry a non-null rating + publishedAt — still validate).
 * Widening is backward-compatible: a non-null rating/publishedAt is a valid
 * nullable value, and the two new fields are optional.
 */
export const FeedItemViewSchema = FeedItemSchema.extend({
  rating: RatingSchema.nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime().optional(),
  sourceCount: z.number().int().nonnegative().optional(),
}).extend(LifecycleReadFieldsSchema.shape);
export type FeedItemView = z.infer<typeof FeedItemViewSchema>;

export const FeedResponseViewSchema = z.object({
  items: z.array(FeedItemViewSchema),
  nextCursor: z.string().datetime().nullable(),
  topViral: z.array(FeedItemViewSchema).default([]),
});
export type FeedResponseView = z.infer<typeof FeedResponseViewSchema>;

/**
 * ADR-0038 Wave 3 unified home feed (`GET /v1/feed/home`): the mixed
 * published-and-open-thread list plus the two highlight rails. `nextCursor` is
 * the OPAQUE keyset token (not a datetime like the legacy feed's cursor).
 */
export const HomeFeedResponseViewSchema = z.object({
  items: z.array(FeedItemViewSchema),
  nextCursor: z.string().nullable(),
  mostViral: z.array(FeedItemViewSchema).default([]),
  mostRecent: z.array(FeedItemViewSchema).default([]),
});
export type HomeFeedResponseView = z.infer<typeof HomeFeedResponseViewSchema>;

export const TrendingItemViewSchema = TrendingItemSchema.extend(LifecycleReadFieldsSchema.shape);
export type TrendingItemView = z.infer<typeof TrendingItemViewSchema>;

export const TrendingResponseViewSchema = z.object({
  items: z.array(TrendingItemViewSchema),
});

export type { CheckLifecycle };
