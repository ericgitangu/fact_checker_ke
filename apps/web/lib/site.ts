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

/**
 * Individual-supporter channels (Buy Me a Coffee / Patreon) — distinct from
 * the org-focused sponsor/partner CTA (<SponsorCta>, `landing.sponsor`),
 * which targets newsrooms/funders/civic-tech partners, not a one-off
 * individual donor. Deliberately read from env rather than hardcoded:
 * placeholder-free by construction, since the owner hasn't created real
 * accounts yet. Unset in an environment -> `undefined` -> the footer (and
 * any other call site) hides that specific link rather than rendering a
 * dead/placeholder href. Set via `NEXT_PUBLIC_BUYMEACOFFEE_URL` /
 * `NEXT_PUBLIC_PATREON_URL` (see apps/web/.env.example) — `NEXT_PUBLIC_`
 * because these are read in a server component at request time but need no
 * secrecy, same visibility class as SITE_URL/GITHUB_REPO_URL above.
 */
export const BUY_ME_A_COFFEE_URL = process.env.NEXT_PUBLIC_BUYMEACOFFEE_URL || undefined;
export const PATREON_URL = process.env.NEXT_PUBLIC_PATREON_URL || undefined;
