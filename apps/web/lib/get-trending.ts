import { ApiClient, type TrendingItem } from "@fact-checker-ke/core";

/**
 * Fetches the "Trending / under review" stream from services/api. Unlike
 * `get-feed.ts`, there is NO demo-fixture fallback: a trending item is a real
 * fetch DISCOVERY with a real tracking status, and inventing fake "under
 * review" rows would misrepresent what the editor is actually assessing. On
 * ANY failure (API down in local dev, network error) this returns an EMPTY
 * list, so `TrendingSection` simply self-hides — an honest "nothing to show"
 * rather than fake data. The `/feed` page's own mock-data banner (from
 * `get-feed.ts`) still tells the reader when the backend is unreachable.
 */
export async function getTrending(options?: { limit?: number }): Promise<TrendingItem[]> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });

  try {
    const response = await client.getTrending(options, { next: { revalidate: 30 } });
    return response.items;
  } catch {
    return [];
  }
}
