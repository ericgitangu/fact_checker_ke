import { createHash } from "node:crypto";

/**
 * ADR-0018 caching table. `submissionEtag`/`checkEtag` compute a strong
 * ETag from the fields that determine whether a cached copy is stale —
 * never the whole payload, so an unrelated field change doesn't bust
 * the cache, and a relevant one always does.
 */
export function etagFor(parts: readonly (string | number | null)[]): string {
  const hash = createHash("sha256").update(parts.map(String).join("|")).digest("hex").slice(0, 32);
  return `"${hash}"`;
}

export function submissionEtag(status: string, updatedAt: string): string {
  return etagFor([status, updatedAt]);
}

/** ADR-0018: drafts and submissions are `private, no-store`. */
export const NO_STORE_CACHE_CONTROL = "private, no-store";

/**
 * ADR-0018: "Published check pages ... s-maxage=300, stale-while-
 * revalidate=86400 ... ETag." `version` is the correction-safety bump —
 * every `check.corrected` increments it so a stale CDN/browser cache
 * can never serve a superseded verdict under the same ETag.
 */
export function publishedCheckEtag(checkId: string, version: number): string {
  return etagFor([checkId, version]);
}
export const PUBLISHED_CHECK_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";

/**
 * ADR-0032 payoff: the "what we're checking now" feed. Shorter
 * `s-maxage` than a single published check (30s, not 300s) — it's a
 * list that grows as new checks publish, and the brief asks for a
 * "light live touch" (poll/revalidate), not a 5-minute-stale front page.
 * Still CDN-cacheable (public), unlike the per-check NO_STORE draft case.
 */
export const FEED_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=300";
