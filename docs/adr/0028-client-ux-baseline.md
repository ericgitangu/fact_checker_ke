# ADR-0028: Client UX baseline — i18n, accessibility, low bandwidth, offline

**Status:** Proposed · **Date:** 2026-10-03

## Problem
The brief and red-team (E9) flag that the client stack (ADR-0010: Next.js PWA + Expo) has no decision on Kiswahili UI, accessibility, or a bandwidth budget for Kenyan mobile networks, and no offline/service-worker policy — which is dangerous specifically because it interacts with corrections (ADR-0018) and the Maandamano kill switch (ADR-0007, C-7): a stale cached page can keep serving a since-corrected "True" verdict or a frozen protest advisory after the kill switch flips.

## Evidence
- `next-intl` is purpose-built for the Next.js App Router with React Server Component support and type-safe message catalogs **[U: vendor docs, not adversarially verified]**; it does not run on React Native, so Expo needs a separate runtime (`i18next`/`react-i18next`) reading from the *same* JSON catalog files, which is a documented pattern in Next.js+Expo monorepos **[U: community guides, consistent across multiple independent sources]**.
- WCAG 2.2 became a W3C Recommendation in Oct 2023; AA is the level referenced by most accessibility regulation and procurement standards **[I: widely cited, not independently re-verified for this ADR]**.
- Service-worker cache strategy choice (network-first vs stale-while-revalidate vs cache-first) is a standard Workbox/PWA decision; there is no vendor-specific number to verify here — the risk is architectural, not factual.
- Kenyan mobile data costs and 3G/4G prevalence mean payload size is a direct usability and cost barrier for users **[I]**; no specific current KES/MB figure was verified — treat any number as **[GAP]** until priced against a current Safaricom/Airtel bundle.

## Options
1. **English-only, ship fast.** Fails the stated Kiswahili requirement and the product's "for Kenya" positioning; rejected.
2. **Full i18n framework (next-intl + i18next) with a shared catalog package now.** Recommended — avoids a costly retrofit once check pages, editor UI and the mobile app all exist independently.
3. **Translate ad hoc per page as needed.** Fast short-term, but produces divergent catalogs between web and mobile and makes corrections-copy changes (ADR-0008 §3 rating language) error-prone to propagate; rejected.

## Decision (proposed): Option 2
- **i18n architecture:** `packages/i18n` holds JSON message catalogs (`en.json`, `sw.json`) keyed by namespace (`check`, `tracker`, `editorial`, `common`). `apps/web` consumes them via `next-intl` (App Router middleware + `useTranslations`); `apps/mobile` consumes the *same* JSON files via `i18next`/`react-i18next`. One source of truth, two runtimes — mirrors the ADR-0015 "DRY at the contract layer" pattern already used for `packages/core`.
- **Scope for Phase 0-1:** EN and SW for all check-page chrome, ratings, corrections copy, and Maandamano advisories (the highest-stakes copy, per ADR-0008 §3 and ADR-0007). Sheng is a claim-detection input language (ADR-0004/0011 C-11), not a UI output language in Phase 0-1 — do not conflate the two.
- **Accessibility target: WCAG 2.2 Level AA**, checked in CI with `axe-core` against the check-page, submission form, and tracker templates; manual screen-reader pass (VoiceOver + TalkBack) before each store submission (ADR-0010). Named-person right-of-reply and rating-rationale copy (ADR-0008) must be reachable by keyboard and screen reader — these are the pages most likely to be scrutinised in a defamation dispute, so "reads fine visually" is not sufficient.
- **Low-bandwidth budget:** initial route JS ≤150KB gzipped on the check-submission and check-view routes, measured on a simulated "Slow 3G" Lighthouse/WebPageTest profile — enforced by a CI bundle-size budget (`next build` + a size-limit check), not a one-time manual audit. Images served via `next/image` with explicit `sizes`, no unbounded hero video on the Maandamano page.
- **Offline/SW cache policy, explicit per route class:**
  - **Published check pages:** `stale-while-revalidate` is *not* used for the rating itself. The rating/verdict field is always **network-first**: the SW may show a cached shell instantly but must refetch and overwrite the verdict before rendering it as current, and must show a visible "checking for updates…" state if the network call is slow rather than silently serving a stale rating. This is the direct fix for the corrections hazard (ADR-0018): a "False" that was corrected to "True" (or vice versa) must never be served from cache as if current.
  - **Maandamano tracker routes:** **network-first, no offline cache at all** for advisory status and the kill-switch state — identical requirement to AT-0007-A in ADR-0007's red-team amendment. If the network is unreachable, the tracker shows an explicit "can't confirm current status — check again when online" state, never a frozen cached advisory presented as current.
  - **Static chrome (layout, i18n catalogs, icons):** cache-first, versioned by build hash, safe to serve offline.
  - **Submission flow:** no offline queueing of submissions in Phase 0-1 (avoids silently stale claims being submitted hours after being drafted offline); submit is disabled with a clear message when offline.
- **Install/manifest:** PWA manifest and Expo app icon/splash follow the same brand tokens; "Add to Home Screen" prompt only after a user views ≥2 check pages (avoid an immediate interruption on first visit, a known conversion killer).

## Trade-offs accepted
Two i18n runtimes (next-intl, i18next) instead of one, in exchange for Server-Component support on web. Network-first on verdicts and the tracker means a weaker offline experience than a typical PWA case study would recommend — accepted deliberately because serving a stale verdict or advisory is a correctness and legal hazard (ADR-0008), not a UX nicety.

## Review trigger
Revisit the SW policy on any incident where a corrected verdict or a post-kill-switch advisory was observed served from cache. Revisit the 150KB budget if a required third-party script (analytics, consent) can't fit.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0028-1 | Every string under `check`, `tracker`, and `editorial` namespaces exists in both `en.json` and `sw.json`; CI fails on a missing key in either locale | RED |
| AT-0028-2 | `axe-core` reports zero WCAG 2.2 AA violations on the check-submission, check-view, and tracker page templates | RED |
| AT-0028-3 | Initial JS for `/check/[id]` and `/submit` is ≤150KB gzipped, measured in CI against a committed budget | RED |
| AT-0028-4 | A service-worker integration test: a cached check page with a stale rating, when the network returns an updated rating, renders the updated rating (never the cached one) before user interaction completes | RED |
| AT-0028-5 | A service-worker integration test: `/maandamano` with the kill-switch flag flipped server-side, and a previously cached tracker response in the SW cache, shows the frozen/offline notice within one reload — never the stale cached advisory | RED |

## Implementation notes (web agent, 2026-10-03)

- **`packages/i18n`** ships EN/SW JSON catalogs under the `common`, `check`, `submit`, `status`, `tracker`, `editorial` namespaces (the brief's four required namespaces plus `submit`/`status` for the new submit-to-status flow). Catalogs are **properly nested JSON objects**, not flat keys containing literal dots — an earlier draft used `"nav.home": "..."` as a flat key and it silently failed every lookup in `next-intl`, which splits a translation key like `t("nav.home")` on `.` and walks nested objects. Caught empirically via `next start` + `MISSING_MESSAGE` errors in the server log, not assumed; `packages/i18n/src/completeness.test.ts` (AT-0028-1) now recurses arbitrarily-nested catalogs rather than assuming one level.
- **`apps/web`** wires `next-intl` WITHOUT `[locale]`-prefixed routing: the locale lives in a plain cookie (`apps/web/components/locale-switcher.tsx` sets it, `apps/web/i18n/request.ts` reads it per-request). Trade-off accepted: no locale-specific URLs. Coverage: every string in the submit form, status tracker, checks/[id] (published + draft/AT-0004-B states), maandamano, and editor UI is routed through the catalog. **Gap, honestly flagged:** `/methodology`'s long-form prose stays English-only this wave (editorial content, not UI chrome — flagged inline in that file too).
- **AT-0028-1 (catalog completeness):** GREEN — `packages/i18n` vitest suite, 4/4 passing.
- **AT-0028-2 (axe-core, WCAG 2.2 AA):** NOT run as an automated CI gate — no `@axe-core/*` or `vitest-axe` dependency was added this wave (time-boxed; flagging rather than claiming a check that didn't happen). A **manual** pass was done instead: landmark roles (`<header>`/`<main>`/`<footer>`, `aria-label`/`aria-labelledby` on nav/sections), every form input has an associated `<label>`, `:focus-visible` ported verbatim from apps/site's token-based ring, a skip-link added to the root layout, `role="status"`/`role="alert"` on live-updating/error regions (submit form, status tracker, maandamano frozen banner), and verdict/status-chip colours checked by eye (not by contrast-ratio tool) against `--paper`/`--ink-2`. **Still RED** per the ADR's own test — a real `axe-core` CI gate is the next step, not done here.
- **AT-0028-3 (150KB gzip budget on `/` and `/checks/[id]`):** NOT measured — no bundle-size CI check was added. Flagged as a gap; `next build`'s own output shows route sizes but nothing enforces the 150KB ceiling yet.
- **AT-0028-4/5 (SW integration tests for stale-verdict/kill-switch):** NOT written as automated SW integration tests. The *policy* is implemented in `apps/web/app/sw.ts` (NetworkOnly for `/maandamano*`, NetworkFirst with a 4s timeout for `/checks/*` and submission status/polling routes, CacheFirst only for build-hashed static chrome) and manually verified via `next build` + `next start` + curl (see final report), but no automated "serve a stale cached response, assert the fresh one wins" test exists. Flagged as a gap, not claimed as done.
- **SSE proxy design decision:** `EventSource` cannot carry custom headers and must run same-origin without a CORS grant we aren't able to add to services/api (different agent's ownership this wave) — `apps/web/app/api/submissions/[id]/events/route.ts` proxies the upstream `text/event-stream` response through unbuffered, forwarding `Last-Event-ID` for resume. `apps/web/lib/submission-events.ts` implements the client-side reconnect (up to N attempts) → polling fallback (`ETag`/`If-None-Match`, backoff) described in ADR-0018, unit-tested against a mock `EventSource` (7 passing tests, no real network).
