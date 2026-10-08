import { mockFeedItems } from "../fixtures/feed-items";
import {
  FeedResponseViewSchema,
  HomeFeedResponseViewSchema,
  type FeedItemView,
} from "./lifecycle-read-model";

export interface FeedPage {
  items: FeedItemView[];
  nextCursor: string | null;
  /** Feed-quality (virality): the top-3 published items by virality score — the
   * "most viral right now" section. Empty when nothing qualifies or on a
   * paginated request (the API only returns it on the first page). */
  topViral: FeedItemView[];
  /** True when the real `GET /v1/feed` wasn't reachable and this is `fixtures/feed-items.ts` instead. */
  isMock: boolean;
}

/** The demo fixture is plain `FeedItem[]`; widen it to the view shape by adding
 * the ADR-0038 lifecycle defaults (every fixture row is a published verdict). */
function asView(items: typeof mockFeedItems): FeedItemView[] {
  return items.map((i) => ({ ...i, lifecycleState: null, authoritative: true, sourceKind: null }));
}

/** Derive the top-3 "most viral" from a set of items (used for the demo-fixture
 * fallback, so the section still demonstrates even without a backend). Mirrors
 * the API ranking: nulls excluded, score desc, ties by publishedAt desc. */
function topViralFrom(items: FeedItemView[], limit = 3): FeedItemView[] {
  return items
    .filter((i) => i.viralityScore !== null && i.viralityScore !== undefined)
    .sort((a, b) => {
      const byViral = (b.viralityScore as number) - (a.viralityScore as number);
      return byViral !== 0 ? byViral : (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    })
    .slice(0, limit);
}

/**
 * Fetches a page of the live feed from services/api; on ANY failure (API down
 * in local dev, network error, etc.) falls back to the `mockFeedItems` demo
 * fixture — so the feed still demonstrates the product even without a running
 * backend, while never presenting that fixture as live data (`isMock: true`).
 *
 * ADR-0038 contract B: this reads the feed with its OWN extended fetch + zod
 * parse (`FeedResponseViewSchema`) rather than the core `ApiClient`, because
 * `ApiClient` zod-strips the additive `lifecycleState`/`authoritative`/
 * `sourceKind` fields the card affordance needs (packages/core is out of scope
 * this wave, so its schemas can't be widened). The URL/params/cache-policy
 * match `ApiClient.getFeed` exactly.
 */
export async function getFeedPage(options?: { limit?: number; cursor?: string | null }): Promise<FeedPage> {
  const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();

  try {
    const res = await fetch(`${apiBaseUrl}/v1/feed${qs ? `?${qs}` : ""}`, { next: { revalidate: 30 } });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const response = FeedResponseViewSchema.parse(await res.json());
    return {
      items: response.items,
      nextCursor: response.nextCursor,
      // The API only populates `topViral` on the first page; fall back to
      // deriving it client-side if an older/cached response omitted it.
      topViral: response.topViral.length > 0 ? response.topViral : topViralFrom(response.items),
      isMock: false,
    };
  } catch {
    const items = asView(mockFeedItems);
    return { items, nextCursor: null, topViral: topViralFrom(items), isMock: true };
  }
}

/**
 * ADR-0038 Wave 3: a page of the UNIFIED home feed (`GET /v1/feed/home`) —
 * PUBLISHED verdicts interleaved with OPEN THREADS (`preliminary`/
 * `awaiting_sources`), plus the two highlight rails (`mostViral`,
 * `mostRecent`). Same fail-soft demo-fixture fallback as `getFeedPage`, and the
 * same OWN extended fetch+parse (the rating/publishedAt are nullable and the
 * lifecycle fields must survive — `ApiClient` would strip/reject them).
 *
 * `cursor` is the OPAQUE keyset token this returns as `nextCursor` (not a
 * datetime). The rails are populated on the first page only (the API omits them
 * on a cursor request), mirroring `topViral`.
 */
export interface HomeFeedPage {
  items: FeedItemView[];
  nextCursor: string | null;
  /** "Most viral" rail (top by virality) — first page only. */
  mostViral: FeedItemView[];
  /** "Most followed" rail — Most-recent FALLBACK until a follows counter exists
   * (packages/db is fenced this wave). First page only. */
  mostRecent: FeedItemView[];
  isMock: boolean;
}

export async function getHomeFeedPage(options?: { limit?: number; cursor?: string | null }): Promise<HomeFeedPage> {
  const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();

  try {
    const res = await fetch(`${apiBaseUrl}/v1/feed/home${qs ? `?${qs}` : ""}`, { next: { revalidate: 30 } });
    if (!res.ok) throw new Error(`home-feed ${res.status}`);
    const response = HomeFeedResponseViewSchema.parse(await res.json());
    return {
      items: response.items,
      nextCursor: response.nextCursor,
      mostViral: response.mostViral,
      mostRecent: response.mostRecent,
      isMock: false,
    };
  } catch {
    // Fallback: the demo fixture is all published verdicts. Derive the rails
    // client-side so the sections still demonstrate without a backend.
    const items = asView(mockFeedItems);
    const mostRecent = [...items].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 3);
    return { items, nextCursor: null, mostViral: topViralFrom(items), mostRecent, isMock: true };
  }
}
