import { ApiClient, type FeedItem } from "@fact-checker-ke/core";
import { mockFeedItems } from "../fixtures/feed-items";

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  /** True when the real `GET /v1/feed` wasn't reachable and this is `fixtures/feed-items.ts` instead. */
  isMock: boolean;
}

/**
 * Fetches a page of the live feed from services/api; on ANY failure
 * (API down in local dev, network error, etc.) falls back to the
 * `mockFeedItems` demo fixture — same try-real-then-fall-back-to-fixture
 * convention as `app/api/editor/drafts/route.ts` — so the feed still
 * demonstrates the product even without a running backend, while never
 * presenting that fixture as live data to the caller (`isMock: true`
 * lets `FeedSection` render the honest "demo data" banner).
 *
 * `cursor` is only honoured against the real backend — the mock fixture
 * is small and fixed, so a cursor against it would just mean "no more
 * pages", which is already the honest outcome of there being a finite
 * fixture.
 */
export async function getFeedPage(options?: { limit?: number; cursor?: string | null }): Promise<FeedPage> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });

  try {
    const response = await client.getFeed(options, { next: { revalidate: 30 } });
    return { items: response.items, nextCursor: response.nextCursor, isMock: false };
  } catch {
    return { items: mockFeedItems, nextCursor: null, isMock: true };
  }
}
