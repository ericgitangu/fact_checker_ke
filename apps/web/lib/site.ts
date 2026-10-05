/**
 * Canonical production origin of the single frontend (ADR-0015: the one
 * Vercel app project `fact-checker-ke-web`). Used as `metadataBase` for
 * absolute OG/canonical URLs and as the base for the sitemap/robots routes,
 * and it is the target the retired apps/site redirect stub points at.
 */
export const SITE_URL = "https://fact-checker-ke-web.vercel.app";

/**
 * Canonical GitHub repository, as credited in README.md ("Author:
 * @ericgitangu"). Used by the footer's "view source" link and the
 * `/join` and `/contact` pages — one constant so the URL only lives in one
 * place rather than being retyped at each call site.
 */
export const GITHUB_REPO_URL = "https://github.com/ericgitangu/fact_checker_ke";
