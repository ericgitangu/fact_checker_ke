import { TrendingResponseViewSchema, type TrendingItemView } from "./lifecycle-read-model";

/**
 * Fetches the "Trending / under review" stream from services/api. Unlike
 * `get-feed.ts`, there is NO demo-fixture fallback: a trending item is a real
 * fetch DISCOVERY with a real tracking status, and inventing fake "under
 * review" rows would misrepresent what the editor is actually assessing. On
 * ANY failure (API down in local dev, network error) this returns an EMPTY
 * list, so `TrendingSection` simply self-hides.
 *
 * ADR-0038 contract B: reads with its OWN extended fetch + zod parse
 * (`TrendingResponseViewSchema`) rather than the core `ApiClient`, which
 * zod-strips the additive `lifecycleState`/`authoritative`/`sourceKind` fields
 * the per-card affordance keys off (see get-feed.ts for the full rationale).
 */
export async function getTrending(options?: { limit?: number }): Promise<TrendingItemView[]> {
  const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();

  try {
    const res = await fetch(`${apiBaseUrl}/v1/trending${qs ? `?${qs}` : ""}`, { next: { revalidate: 30 } });
    if (!res.ok) throw new Error(`trending ${res.status}`);
    const response = TrendingResponseViewSchema.parse(await res.json());
    return response.items;
  } catch {
    return [];
  }
}
