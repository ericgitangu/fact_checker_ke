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

---
## Implementation amendment (2026-10-05): monetization v2 — direct M-Pesa + Stripe rails, authoritative geo-IP consent, expiry sweeper

Builds on the provider-agnostic billing seam above. Still ADDITIVE and fail-closed: every rail is invisible/inert (`503`/`401`/no-op) until the owner sets its env, and nothing calls a LIVE payment endpoint (M-Pesa defaults to the Daraja **sandbox** base URL; Stripe uses the owner's test keys). Closes three of the previous amendment's "Known gaps" (live M-Pesa checkout, authoritative consent geo-IP, the expiry sweeper).

### New PSP adapters (behind the same seam)
- **M-Pesa** (`services/api/src/lib/billing/mpesa.ts`) — direct Safaricom Daraja **C2B STK push** (no Paystack intermediary; settles straight to the till). OAuth client-credentials → `POST /mpesa/stkpush/v1/processrequest` (password = `base64(shortcode+passkey+timestamp)`, `YYYYMMDDHHmmss`). Pattern ported from the moovn-backend Daraja integration; **no secret values copied** — all read from fact_checker_ke's own env. Callback authenticity: Daraja does **not** HMAC-sign its callback, so `verifyWebhook` fails closed unless a **source-IP allowlist** (`MPESA_CALLBACK_IP_ALLOWLIST`) is set AND the request IP is in it AND the body is a well-formed `stkCallback` — mirrors moovn's edge-allowlist + result-field defense. The owner MUST also keep an edge (nginx/LB) allowlist; the app check is defence-in-depth.
- **Stripe** (`services/api/src/lib/billing/stripe.ts`) — Checkout Session (`payment` mode — a one-off Premium **pass**, not an auto-renewing subscription; see below) via the official `stripe` npm package; webhook verified with `stripe.webhooks.constructEvent` over the RAW body, grant on `checkout.session.completed` + `payment_status=paid`.
- Both registered in `lib/billing/registry.ts`; `POST /v1/billing/checkout` selects by the request `provider ∈ {paystack,mpesa,stripe}` and returns the real checkout (STK push initiated / Stripe Checkout URL) when configured.

### Contract changes (packages/core, additive)
- `BillingProviderSchema` gains **`mpesa`** (DB `billing_provider` enum extended in **migration `0019`**).
- `CheckoutResultSchema` gains a `kind ∈ {redirect,stk_push}` (default `redirect`, so the pre-existing `{provider,authorizationUrl,reference}` shape is unchanged) — M-Pesa returns `stk_push` with **no** `authorizationUrl` (the prompt goes to the phone) + a `customerMessage`. `CheckoutInputSchema` gains an optional `phone` (M-Pesa STK target; normalised + validated server-side; never the subject).

### Subject reconciliation — `pending_checkout_subjects` (migration `0019`)
Paystack/Stripe echo the subject in event metadata; M-Pesa's callback echoes **only** its `CheckoutRequestID`. So the checkout route records `(provider, reference) → device_token_hash` at checkout time and the webhook route falls back to it when the event carries no subject — provider-generic (hardens Paystack/Stripe too), and a missing/expired mapping degrades safely to "never guess whose premium to turn on". Rows are pruned by the sweeper (1-day cutoff).

### Premium is a fixed-length PASS (not auto-renew)
Both direct rails are one-off payments (M-Pesa C2B has no standing order; Stripe uses `payment` mode), so a successful payment grants `PREMIUM_PERIOD_DAYS` (30) from payment time. **Recurring/auto-renew subscriptions are explicitly OUT OF SCOPE** (need renewal webhooks — Stripe `invoice.paid`, an M-Pesa standing order — which neither sandbox exercises); a future recurring tier is additive. `STRIPE_PRICE_ID` must therefore be a **one-time** price.

### Authoritative geo-IP consent (apps/web) — replaces the client timezone heuristic
`lib/consent-region.ts` (`countryRequiresConsent`, EU-27 + EEA + UK) decides the region server-side from the platform geo header **`x-vercel-ip-country`** (read in `app/layout.tsx` via `next/headers`), threaded to the client via `ConsentRegionProvider`. The client banner still renders, but `useAdsConsent` now takes the server flag as authoritative; the old timezone heuristic remains only as the FALLBACK when no geo signal is present (local dev / non-Vercel host) — never a regression to "assume non-EEA".

### Entitlement expiry sweeper — access is no longer only lazy
`lib/entitlement-sweep.ts` (`runEntitlementSweep`) flips lapsed `active` rows to `expired` (durable, not only read-time) and prunes stale pending-checkout rows. Exposed as a signature-verified `POST /internal/entitlements/sweep` AND piggybacked on the existing `/internal/outbox/drain` sweeper (ADR-0021 pattern — no new cron required).

### Env the owner must set to go live (all fail-closed/inert when unset)
- **M-Pesa:** `MPESA_C2B_CONSUMER_KEY`, `MPESA_C2B_CONSUMER_SECRET`, `MPESA_C2B_SHORTCODE`, `MPESA_C2B_ONLINE_PASSKEY`, `MPESA_C2B_CALLBACK_URL`, `MPESA_CALLBACK_IP_ALLOWLIST` (Safaricom ranges), `MPESA_C2B_AMOUNT` (KES price), `MPESA_ENV` (`sandbox`→live only when flipped to `production`).
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` (one-time price).
- Secrets via GCP Secret Manager only; `MPESA_ENV` stays `sandbox` until the owner deliberately goes live.

### Known gaps (no silent tech debt)
- Recurring/auto-renew subscriptions not implemented (one-off passes only) — see above.
- M-Pesa callback app-layer authenticity relies on the source-IP allowlist + result fields; an edge allowlist is still required (Daraja sends no signature). No STK status-query reconciliation for a lost callback (the pass simply isn't granted; the reader retries).
- No proration/refund/downgrade beyond activate + expire; the sweeper makes expiry durable but there is still no renewal path.
