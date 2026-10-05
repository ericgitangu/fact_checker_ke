# ADR-0012: Monetization sequencing

**Status:** Proposed · **Date:** 2026-10-03

## Problem
The brief wants ads, sponsors, subscriptions and creator-funnel revenue. Monetizing a political fact-checker creates a perceived-bias risk, which is the product's core asset. App-store rules also constrain payments.

## Evidence
- Apple: premium features and content need IAP, and auto-renewable subscriptions must run at least 7 days **[U]**.
- AdSense/AdMob policy on political and news content: a source was fetched but nothing was verified **[GAP]**.
- Africa-focused fact-checkers lost Google and Meta support in 2025 **[U, Poynter source fetched]**, which shows that platform funding is unreliable.

## Decision (proposed)
1. **Phase 0-1: no ads.** Ads next to protest and political verdicts invite "who's paying you" attacks, and AdSense policy is unverified **[GAP]**.
2. **Phase 2: disclosed sponsorships and grants.** Media-development funders, civic-tech grants and newsroom partnerships. Publish a funding page (IFCN transparency).
3. **Phase 2: "Pro" subscription.** Covers higher submission quotas, alerts, API access for newsrooms, and no ads (once ads exist). Use IAP on iOS and Play Billing on Android, and web checkout on the PWA.
4. **Phase 3: non-intrusive ads.** Only on non-political pages, only after verifying the policy, and never on the tracker or verdict pages.
5. **Rule:** monetization can never affect which claims get checked or how they are rated. Write this into the editorial policy (ADR-0008).

## Trade-offs accepted
Slower revenue in exchange for protecting the credibility asset.

## Review trigger
Revisit once there is verified AdMob/AdSense policy research, or at 10k MAU.

---
## Research round 2 (2026-10-03): amendments for grooming

- **AdMob/AdSense "Sensitive Events" policy** (since Feb 2024) bans profiting from or exploiting civil emergencies, conflict and mass violence, but reportedly "won't impact news reporting" **[V2-SECONDARY, consistent across 3 sources]**. Ads beside fact-checks are likely permissible. **Ad copy or targeting that references a protest is not.** Kenya-specific political-ad rules: **[GAP]**. Phase 3 timing is unchanged.
- **Apple:** the US-only external-checkout carve-out (May 2025) **does not extend to Kenya**. iOS subscriptions must use IAP **[V2-SECONDARY]**.
- **Google:** alternative/user-choice billing rollout phases **don't list Kenya** before the rest-of-world phase (30 Sep 2027) **[V2-SECONDARY]**. Play Billing is required.
- Web (PWA) subscriptions can use any processor (for example M-Pesa via a PSP). Price parity and the inability to link from the apps are **[I]**.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #15 (README/hygiene wave, medium severity; cross-reference only — the substantive change is in ADR-0015).

- **ADR-0015's trigger for moving off Vercel Hobby is broadened** from "ads or payments ship" to also cover sponsors, grants and operating as an incorporated entity — all of which Vercel's fair-use terms treat as commercial use (red-team C-15). This ADR's monetization sequencing (no ads until Phase 3, Pro subscription in Phase 2) is unchanged; see ADR-0015's amendments for the hosting-tier consequence.

---
## Implementation amendment (2026-10-05): entitlement model, provider choice, ad scaffold

Builds the monetization *surfaces* as ADDITIVE, env-gated, fail-closed scaffolding, consistent with the sequencing above (ads ship INERT; nothing turns on until the owner configures accounts). Complements — does not replace — the existing pre-launch scaffolding (`<PremiumTeaser>` → waitlist, footer supporter links).

### Provider recommendation — Paystack (lead) over Stripe
- **Paystack (recommended):** Kenya-native. Settles in **KES** and supports **M-Pesa + cards** natively — the dominant Kenyan rails. Webhook signature is `HMAC-SHA512(rawBody, SECRET_KEY)` in `x-paystack-signature` (pure crypto — implementable/testable now without an account).
- **Stripe (fallback):** excellent global tooling, but **no native M-Pesa** (needs a third-party aggregator) and KES support is limited — a worse fit for the primary audience.
- **Decision:** scaffold Paystack first behind a provider-agnostic seam (`services/api/src/lib/billing/*`). Adding Stripe later is one new adapter + one registry line, no route change. `manual` is a first-class provider for admin/newsroom comps (no PSP, never-expiring).

### Entitlement model (server-authoritative)
- New table **`entitlements`** (migration `0017`): subject is EXACTLY ONE of `device_token_hash` (readers are device-identified; `users` is editors/admins only) or `user_id` (wired for a future authenticated reader/comp), enforced by a CHECK. `status ∈ {active,expired,canceled}` is the lifecycle label; **`current_period_end` is the source of truth for access** — the ad-free decision is `status≠expired AND (period IS NULL OR period>now)` (cancel-at-period-end honoured). `(provider, provider_ref)` is a partial unique index for webhook-replay idempotency.
- New table **`billing_events`**: every verified webhook recorded idempotently on `(provider, event_id)` before its side effect (ADR-0017 inbox pattern) — a PSP retry acks without re-granting.
- **The ad-free / premium decision is server-side only** (`GET /v1/entitlement`); the web treats the result as opaque truth and defaults to the fail-safe NO_ENTITLEMENT (ads ON) on any failure.

### Routes (services/api)
- `GET /v1/entitlement` — reads `X-Device-Token`, returns the projected entitlement. **Buildable now.**
- `POST /v1/billing/checkout` — fail-closed stub: `503` when `PAYSTACK_SECRET_KEY` unset, `501` when set (the live `/transaction/initialize` call is a documented TODO — this scaffold NEVER calls a live payments API). **Needs the owner's account.**
- `POST /v1/billing/webhook/:provider` — verifies signature (fail-closed), dedupes, and activates the entitlement from the subject carried in PSP metadata. Signature-verify + parse + grant logic is **buildable now**; it only does anything real once the owner's webhook secret is set.

### Ads (apps/web)
- `<AdSlot>` — CLS-safe (reserves height), lazy-loads (IntersectionObserver), labelled "Ad", renders NOTHING unless `NEXT_PUBLIC_ADSENSE_CLIENT` + the per-placement slot id are set, nothing for ad-free readers, and nothing until consent is satisfied. Placements: in-feed after item 4 (full `/feed` only), in-article BELOW the assessment on the check page — never above the fold, never between a claim and its evidence.
- `<ConsentBanner>` — EEA/UK CMP (timezone heuristic; **the authoritative signal is server/CDN geo-IP — flagged as the real fix, not wired here**). Gates the AdSense loader; decline is equally weighted.

### Env the owner must set to activate (all fail-closed/invisible when unset)
- API: `PAYSTACK_SECRET_KEY` (secret-manager only), plus `WEB_BASE_URL` for the checkout callback.
- Web: `NEXT_PUBLIC_ADSENSE_CLIENT`, `NEXT_PUBLIC_ADSENSE_SLOT_INFEED`, `NEXT_PUBLIC_ADSENSE_SLOT_INARTICLE`.

### Known gaps (no silent tech debt)
- Live Paystack `createCheckout` is intentionally un-shipped (501) — the purchase loop isn't closeable until the account exists.
- Consent region detection is a client timezone heuristic, not authoritative geo-IP.
- No proration/refund/downgrade lifecycle beyond activate + cancel-at-period-end; expiry is lazy (decided at read time, no sweeper) — a lapsed `active` row simply reads as not-active until a future sweep flips its status.
