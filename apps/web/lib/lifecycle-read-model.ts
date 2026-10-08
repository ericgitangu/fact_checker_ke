import { z } from "zod";
import { CheckLifecycleSchema, FeedItemSchema, TrendingItemSchema, type CheckLifecycle } from "@fact-checker-ke/core";

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

export const FeedItemViewSchema = FeedItemSchema.extend(LifecycleReadFieldsSchema.shape);
export type FeedItemView = z.infer<typeof FeedItemViewSchema>;

export const FeedResponseViewSchema = z.object({
  items: z.array(FeedItemViewSchema),
  nextCursor: z.string().datetime().nullable(),
  topViral: z.array(FeedItemViewSchema).default([]),
});
export type FeedResponseView = z.infer<typeof FeedResponseViewSchema>;

export const TrendingItemViewSchema = TrendingItemSchema.extend(LifecycleReadFieldsSchema.shape);
export type TrendingItemView = z.infer<typeof TrendingItemViewSchema>;

export const TrendingResponseViewSchema = z.object({
  items: z.array(TrendingItemViewSchema),
});

export type { CheckLifecycle };
