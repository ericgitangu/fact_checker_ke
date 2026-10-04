# ADR-0007: Maandamano tracker — safety, legal posture and data model

**Status:** Proposed · **Date:** 2026-10-03

## Problem
A live, ongoing protest heatmap with live feeds and comments is useful to the public, the press and families. It can also be used to target protesters, to dispatch counter-groups, or as grounds for blocking the app. This is the feature most likely to cause real-world harm and regulatory action.

## Evidence
- The Court of Appeal (6 Mar 2026) declared CMCA ss.22-23 (false publication) unconstitutional **[U, Wayback source]**.
- The 2025 CMCA amendments give the NC4 power to order websites or apps blocked or removed, with critics noting no judicial oversight. Some parts of the amendments were suspended by the court; it is unclear whether the blocking power was **[U]**.
- The High Court quashed the Communications Authority (CA) directive banning live broadcast of protests. That ruling covers licensed broadcasters, not apps or streams **[U]**.
- Apple 1.2 requires filtering, reporting, blocking and contact info for any UGC **[U]**. Apple 5.1.5 permits location only where it is relevant to the app's features. 5.1.1(ix) says apps in regulated or sensitive fields should be submitted by a legal entity **[U]**.

## Options
1. **Real-time crowd-sourced pins and live feeds.** Rejected for Phase 0-1: it enables targeting, the content is unverifiable, and UGC moderation load would be heavy on day one.
2. **Editor-curated advisories with coarse, delayed geography.** Recommended.
3. **No protest feature.** Rejected: it is the core differentiator.

## Decision (proposed): Option 2
- **Event model:** `Demonstration { id, status: rumoured|announced|confirmed|ongoing|ended|cancelled, area (ward/sub-county polygon, not point), window, organiser_claimed, sources[] (credited), advisories[], last_verified_at, verified_by }`.
- **Status "rumoured"** is itself a fact-check target. Viral calls to protest go through ADR-0004.
- **Heatmap:** aggregate to ward or sub-county level. No user GPS is stored. For *ongoing* events, delay public granularity by 15-30 minutes **[I: tune with legal review]**.
- **Live feeds:** embed only public streams from licensed outlets, credited (Citizen, NTV, KTN YouTube embeds). Don't re-stream, and don't surface individual creators' location-bearing streams in Phase 0-1.
- **Advisories:** road closures, transport, hospital and legal-aid hotlines (LSK, KNCHR, Red Cross). Source and timestamp every item.
- **Comments:** arrive in Phase 1 only, with the full Apple 1.2 toolset (filtering, report, block, published contact) plus rate limits and a no-faces and no-names policy for uploads.
- **Kill switch:** an operator-level feature flag that freezes the tracker without a deploy. This is the response to an NC4 order or an escalation of violence.

## Trade-offs accepted
Less "live" than Twitter Spaces or TikTok Live. Safety and the app's legal survival outrank engagement.

## Review trigger
Revisit after a legal opinion (ADR-0008), or after the first incident report or takedown request.

---
## Research round 2 (2026-10-03): amendments for grooming

- **The NC4 blocking power has reportedly been struck down.** A High Court ruling (about 2 Jul 2026, Nyaundi J) reportedly declared the 2025 amendment's s.6(1) (NC4 blocking and removal) and s.27(1) (cyber harassment) unconstitutional. No appeal was found **[V2-SECONDARY: judgment text not retrieved]**. **Keep the kill switch:** the provision could be reinstated on appeal, and other takedown routes exist.
- CA live-broadcast ban quashed (Chigiti J; Katiba Institute petition; directive dated 25 Jun 2025) **[V2-SECONDARY: no case number]**. It covers broadcasters. Embedding licensed broadcasters' streams fits that precedent.
- **Public Order Act (Cap 56) s.5:** the duty to give 3-14 days' notice falls on *organisers* **[V2-PRIMARY: kenyalaw.org]**. A useful data source: a "notified to regulating officer" field can strengthen `announced`/`confirmed` status when the notice is public. No ruling covers third parties republishing protest schedules **[GAP: advocate question]**.
- **Google Play sensitive-events policy** allows content with educational or documentary value that raises awareness, but enforcement is judgment-based **[V2-SECONDARY]**. Keep the tracker's framing informational (safety advisories, sources), never mobilising.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #11 (high severity).

- **Kill-switch mechanism, specified.** The kill switch is a runtime flag in the DB/edge config (not a deploy), and flipping it must also: purge the ISR tag for tracker routes so the Vercel CDN stops serving stale pages, and flip the PWA service worker to network-first on tracker routes so the SW cache can't keep serving a frozen protest area. (Closes red-team C-7: "kill switch is leaky" — a flag flip alone leaves CDN/SW layers serving stale content.)
- **Log redaction on tracker routes.** Cloud Run and Vercel request logs must exclude or redact IPs of people who viewed `/maandamano` (Terraform-enforced log exclusion filter). (Closes part of red-team C-8.)
- **EXIF stripping on upload**, for any photo attached to a tracker advisory or (future) comment.
- **Advisories auto-grey after 2h without re-verification.** A "road open"/status advisory that hasn't been re-confirmed by an editor within 2 hours is visually marked stale rather than silently continuing to display as current — this closes the staleness gap noted for safety-relevant advisories.
- **Ongoing-event comments are off** (comments remain Phase 1 per the existing decision above, but ward-level coarsening is defeated by comments like "tuko Kenol sasa" — so comments on *ongoing* events specifically stay off or go to editor-held review, even once Phase 1 UGC otherwise ships).
- The full data-protection treatment of protest-viewer exposure (log retention policy, DSAR interaction, cross-border transfer basis) is tracked in the forthcoming Data protection lifecycle ADR (see README pointer list) — this amendment covers only the mechanical log-exclusion/EXIF pieces that belong to this ADR's tracker design.

## Acceptance tests

| ID | Behaviour | Status |
|---|---|---|
| AT-0007-A | Within 60s of the kill-switch flag flipping, tracker routes return a frozen notice from CDN, API and service worker (the SW revalidates tracker routes network-first). | **GREEN** (mechanism; see 2026-10-04 notes below) |
| AT-0007-B | A log exclusion/redaction filter is enforced (Terraform) on tracker routes. EXIF is stripped on upload. Comments on ongoing events are off or held for review. | RED |

## Implementation notes (web agent, 2026-10-03)

- **`/maandamano` (apps/web)** renders the fixture-backed advisory list using a new `CheckCard`-family visual language (`advisory-card`, `status-chip` — see `apps/web/components/status-chip.tsx`), with the night-band `.street` framing (`apps/web/components/night-band.tsx`) carrying the "what's happening, not who is where" intro copy for every one of the 6 `DemonstrationStatus` values, translated (EN/SW) via the `tracker` i18n namespace.
- **Status chips are deliberately NOT the verdict colour scale.** `apps/web/app/globals.css` defines a separate `--status-neutral/--status-amber/--status-slate` scale distinct from `--true`/`--false`/etc., so a protest's status is never visually conflated with a fact-check rating (this ADR's own framing: a tracker advisory is not a verdict).
- **Kill switch (AT-0007-A), partial implementation:** `isFrozen()` in `apps/web/app/maandamano/page.tsx` reads a `MAANDAMANO_FROZEN` env var as a stand-in for the real operator-level DB/edge-config flag described in this ADR — flipping it renders the frozen-notice view instead of advisories. This covers only the **apps/web rendering half** of AT-0007-A; the real flag storage/propagation (DB row, CDN tag purge) is backend/infra scope, out of this wave's file ownership. The **service-worker half is implemented unconditionally** (not gated on the env var): `apps/web/app/sw.ts` runs `/maandamano*` through `NetworkOnly` — no offline cache at all, ever, independent of whether the mock flag is set — so a stale cached advisory can never be served regardless of kill-switch state. This is stronger than strictly required (ADR-0028 agrees: "no offline cache at all" for tracker routes) but was the simplest correct policy to implement with confidence.
- **2h staleness amendment:** `apps/web/app/maandamano/page.tsx`'s `isStale()` marks an advisory with a visible warning (`tracker.staleWarning`, EN/SW) when `updatedAt` is more than 2 hours old — evaluated against the fixture's static timestamps, not a live re-verification clock (no editor re-verification workflow exists yet to update it).
- **Not implemented this wave (explicitly out of scope per the task brief):** log redaction (AT-0007-B, Terraform/infra), EXIF stripping on upload (no upload feature exists in apps/web yet), comment gating on ongoing events (no comments feature exists yet — Phase 1 per the ADR itself).

## Kill-switch mechanism, real implementation (2026-10-04)

AT-0007-A closes the gap the 2026-10-03 notes above left open (the
`MAANDAMANO_FROZEN` env var was a client-only mock). The mechanism is
now real, end to end:

- **The flag.** `maandamano_kill_switch` is an ordinary row in the
  existing `policy_flags` table (ADR-0031 scaffold) — no new table or
  migration. Defaults OFF (missing row = not frozen). Flipped ONLY via
  the existing `updatePolicyFlag` (`services/api/src/lib/policy-audit.ts`),
  so every flip writes a `policy_flags` row AND an `audit_log` row
  (`action: 'policy.kill_switch_flipped'`, `target_id:
  'maandamano_kill_switch'`) in the SAME transaction — a rolled-back
  flip leaves zero rows in either table, same discipline as every other
  audited mutation in this codebase. See
  `services/api/src/lib/maandamano.ts`.
- **Admin-only flip:** `POST /v1/admin/maandamano/kill-switch`
  (`services/api/src/routes/maandamano.ts`), guarded by
  `requireRole(auth, ["admin"])` — same pattern as
  `routes/funnel.ts`. Body `{ enabled: boolean }`.
- **Server-side enforcement (the part a CSS/JS hide can't fake):**
  `GET /v1/maandamano` (same route file) calls
  `getMaandamanoAdvisories(db)`, which reads the flag FIRST and, when
  it's on, returns `{ frozen: true, demonstrations: [] }` WITHOUT ever
  querying the `demonstrations` table. The live rows are never deleted
  — they're simply never read while frozen, and reappear the instant
  the flag flips back. Proven against a real Postgres instance by
  `services/api/src/__tests__/maandamano-killswitch.integration.test.ts`
  (inserts a live row, flips the switch, asserts the row still exists
  in Postgres but `GET /v1/maandamano` returns `demonstrations: []`).
  `apps/web/app/maandamano/page.tsx` now renders directly from this
  endpoint (`ApiClient.getMaandamano`) instead of a bundled fixture —
  there is no client-side "hide the list" step for a reader to bypass,
  because the server never sends the list while frozen.
- **Fast propagation (no redeploy):** `/maandamano` is ISR-cached
  (`export const revalidate = 60`, fetch tag `"maandamano"`). Flipping
  the switch calls `services/api/src/lib/maandamano-revalidate.ts`,
  which POSTs `apps/web/app/api/revalidate/route.ts` (secret-gated via
  `REVALIDATE_SECRET`), which calls `revalidateTag("maandamano", {
  expire: 0 })` — Next 16's documented route-handler/webhook form for
  "I need this gone immediately" (its `updateTag` alternative only
  works inside Server Actions, not here). If `WEB_BASE_URL`/
  `REVALIDATE_SECRET` aren't configured, the flip still succeeds and is
  still audit-logged — propagation just can't also reach the CDN layer,
  logged as a warning rather than failing the request. The runbook
  (`docs/runbooks/nc4-kill-switch.md`) now documents this exact
  mechanism instead of a TBD curl placeholder.
- **Residual, honestly flagged:** the actual `/maandamano` route
  renders dynamically (`ƒ` in the `next build` output) because of
  shared app-shell logic (locale resolution), not because of this
  change — so in THIS build, the CDN never held a static/ISR page for
  that tag purge to act on in the first place; what the webhook
  actually buys today is instant invalidation of the Next **Data
  Cache** entry for the `GET /v1/maandamano` fetch (bounding staleness
  to 0s instead of up to 60s), not a CDN edge-cache purge. If a future
  change makes `/maandamano` statically/ISR-renderable, the same tag
  purge then also covers the CDN layer with no further code change.
  AT-0007-B (log redaction, EXIF stripping, ongoing-event comment
  gating) is still RED and out of this change's scope.
