# ADR-0029: Cost model and runway

**Status:** Accepted (cost floor acknowledged; advocate retainer still [GAP]; STT line corrected to Chirp_2 post Round-A, owner, 2026-10-03) · **Date:** 2026-10-03

## Problem
Red-team U8/E10: there is no cost or runway model anywhere in the ADR set. Known costs are scattered (Vercel Pro in ADR-0015, STT in ADR-0005, X posting in ADR-0003, ODPC in ADR-0008), free tiers are scattered (ADR-0009), and revenue is at least 3 months out (ADR-0012 Phase 2) while some costs start at launch. A solo founder needs to know, in one place, what binds first and what a "sustainable" subscriber/sponsor count looks like.

## Evidence (reused from accepted/researched ADRs, not re-verified here)
- Vercel Pro: **$20/mo**, required before any commercial use (ads, payments, sponsor acknowledgement) **[V, ADR-0015]**.
- Apple Developer Program: **$99/yr** ≈ **$8.25/mo** amortised **[V: magora-systems.com/apple-developer-fee, appbuilder24.com — consistent across sources]**.
- Google Play Console: **$25 one-time**, no recurring fee **[V: dianapps.com, consistent with other sources]** — amortised to ≈$0 after month 1.
- ODPC registration (micro/small org): **KES 4,000 per 24 months** ≈ KES 167/mo ≈ **$1.30/mo** at ~128 KES/USD **[V2-SECONDARY, ADR-0008]**.
- Domain: typical `.com`/`.ke` renewal **$12-20/yr** ≈ **$1-1.70/mo [GAP: exact registrar/TLD not chosen]**.
- Advocate retainer (required before first named-person verdict, ADR-0008): **[GAP — no amount researched]**. Treat as the single largest unknown fixed cost; get a quote before Phase 1 exits.
- Paid STT (AWS Transcribe): **$0.024/min** at low volume, falling to $0.015/$0.0102/$0.0078/min at higher tiers; one source gives a lower $0.006-0.01/min figure — **sources conflict, treat as [U]**, re-price against the AWS console before relying on it. Swahili-specific pricing/accuracy is still **[GAP]** (ADR-0005).
- X posting: **$0.015/post (text-only), $0.20/post (with a URL)** **[V2-PRIMARY, ADR-0003]**.
- LLM tokens (ADR-0011): Haiku 4.5 **$1/$5 per MTok** in/out **[V2-PRIMARY]**; Opus 5.5 **$4/$20 per MTok [V2-PRIMARY]**; the mid-tier figure reported as "$2/$10" is tagged **[needs re-check]** in ADR-0011 — carried here as **[U]**, not upgraded.
- Free tiers (ADR-0009): QStash **1,000 msgs/day** (retries count) **[V2-PRIMARY]**; Upstash Redis **500K commands/month [V2-SECONDARY]**; Neon **100 CU-h/month, scale-to-zero after 5 min [V2-SECONDARY]**; Cloud Run **2M requests, 180K vCPU-s, 360K GiB-s/month [V2-SECONDARY]**; Vercel Hobby **1M invocations / 4h Active CPU per month [V, ADR-0015]** (moot pre-commercial per ADR-0015, since Hobby is non-commercial-only).

## Decision (proposed)

### Fixed monthly cost floor (Phase 0-1, pre-commercial)
| Item | Monthly | Status |
|---|---|---|
| Vercel Hobby | $0 | — (switches to Pro at first commercial use) |
| Apple Developer | $8.25 | [V] amortised |
| Google Play | ~$0 after month 1 | [V] amortised |
| ODPC | $1.30 | [V2-SECONDARY] |
| Domain | $1.50 | [GAP: registrar TBD] |
| Advocate retainer | **[GAP]** | treat as $0 only until a quote exists — do not launch named-person verdicts assuming $0 |
| **Floor (excluding advocate)** | **≈ $11/mo** | |

### Fixed cost floor once commercial (Phase 2, ADR-0012)
Add Vercel Pro ($20/mo) → **≈ $31/mo** floor, excluding the advocate retainer GAP.

### Variable cost per check (formula)
```
cost_per_check =
    (detect_in_tok  × haiku_in_rate  + detect_out_tok × haiku_out_rate)      # claim detection, ADR-0011 step 1
  + (draft_in_tok   × model_in_rate + draft_out_tok  × model_out_rate)      # draft verdict, only for new/unique claims (ADR-0004 step 3 dedup)
  + (has_audio ? stt_minutes × stt_rate_per_min : 0)                        # ADR-0005, user uploads/live only
  + qstash_marginal_cost(messages_over_free_tier)                           # 2 msgs/check per ADR-0009 accepted decision; $0 under 1,000/day
```
Worked example at list price, **no caching discount applied** (caching would lower the detect-stage cost further per ADR-0011 §3, by ~10× on cache reads):
- Detect (Haiku, 3,000 in / 500 out tok): 3,000/1e6×$1 + 500/1e6×$5 = **$0.0055**
- Draft (mid-tier model, [U] pricing, 2,000 in / 800 out tok, dedup-filtered so this runs on an estimated 40% of submissions per ADR-0011 §2): 0.4 × (2,000/1e6×$2 + 800/1e6×$10) = 0.4 × $0.012 = **$0.0048**
- STT (20% of checks carry audio, avg 2 min, AWS Transcribe low-volume rate [U]): 0.2 × 2 × $0.024 = **$0.0096**
- QStash: **$0** while under the 1,000 msgs/day free tier
- **Blended cost per submitted check ≈ $0.020**, list price, uncached. Treat as an upper bound.

### Free-tier exhaustion: which binds first
At 2 QStash messages per check (ADR-0009 accepted two-hop pipeline) plus sweeper/retry overhead (red-team C-3), the **1,000 msgs/day QStash free tier caps usable throughput at roughly 300-500 checks/day** — this is the tightest ceiling by a wide margin:

| Service | Free-tier ceiling | Implied check volume | Binds before QStash? |
|---|---|---|---|
| QStash | 1,000 msgs/day | ~300-500 checks/day | **binds first** |
| Upstash Redis | 500K cmds/month | ~3,300 checks/day (at ~5 cmds/check) | no — ~7-10× looser |
| Cloud Run | 2M req/month | ~65,000 checks/day equivalent | no — far looser |
| Neon | 100 CU-h/month | not directly check-denominated **[I]**; bound by always-on background jobs (sweeper interval), see ADR-0009/0017 C-4 | no, if sweeper ≥60 min |
| Vercel Hobby | 1M invocations/4h Active CPU | n/a once Pro is required pre-commercial | moot |

**Conclusion: QStash message volume, not compute or DB, is the binding constraint on daily check throughput**, and it binds at roughly 2 orders of magnitude below Cloud Run's ceiling. Any viral-spike mitigation (ADR-0011 §6, ADR-0017 amendment D-2) is therefore a QStash-quota problem first.

### Break-even: Pro subscription and sponsorship
Fixed floor once commercial ≈ **$31/mo** (excluding the advocate-retainer GAP, which could dominate this entirely once quoted). Store cut on IAP/Play Billing: assume the small-business tier (~15%) **[I, not re-verified here — see ADR-0012]**, so net revenue per subscriber ≈ 85% of list price.
- At a **$3/mo Pro price** (illustrative — not yet decided, flag as **[GAP: pricing decision]**): net ≈ $2.55/subscriber/mo → **break-even at ≈ 13 subscribers**, before the advocate retainer.
- A single disclosed sponsor or grant covering $31-50/mo clears the floor immediately and is the faster near-term path (ADR-0012 Phase 2 sequencing already prefers sponsorship before Pro).
- **The advocate retainer is the number that could invalidate this whole table.** Get a quote before treating 13 subscribers as "sustainable."

## Trade-offs accepted
This model uses list LLM prices with no caching/dedup discount, so actual spend should run below these numbers — deliberately conservative rather than optimistic, since under-budgeting is the failure mode that kills runway.

## Review trigger
Revisit on the first advocate quote, on the first month of real QStash/Redis/Cloud Run usage data, or if Pro pricing is set.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0029-1 | A per-check cost telemetry row (ADR-0011 §7) exists for every published check, and its `usd` sum over a rolling 30 days is compared against the formula's blended estimate in a monthly report | RED |
| AT-0029-2 | A budget alert fires at 70% of the QStash daily message quota (ties to ADR-0009/0017 amendment D-13) | RED |
| AT-0029-3 | The release checklist (ADR-0015 AT-0015-4) blocks a Pro-tier switch decision on an explicit sponsor/subscriber count check, not a date | RED |
| AT-0029-4 | A runway calculation (fixed floor ÷ net monthly revenue) is recomputed and stored whenever Pro pricing or the advocate retainer amount changes, not hardcoded | RED |

## Correction (2026-10-03): STT line, post ADR-0005 Round A

The worked example's STT line (§"Variable cost per check") used an AWS
Transcribe placeholder rate (**$0.024/min**, low-volume tier, tagged
**[U]**) because no ASR provider had been benchmarked yet when this ADR
was first drafted. AWS Transcribe was never actually a candidate the
pipeline implements against — it was a cost-reference figure only.

[ADR-0005](0005-speech-and-language.md) has since run its Round A
benchmark on a 30-clip Kenyan eval set. Result: **GCP STT v2 Chirp_2 is
the provisional ASR winner** — 7.8% WER vs. Gemini 2.5 Flash's 18.4% WER,
and Gemini additionally produced a silent empty transcript on one
politically sensitive clip (a disqualifying failure mode for a political
fact-checker). **Gemini is not the default** — it remains only a cheap
secondary/fallback pending Round B (Sheng/noisy-audio clips).

This ADR's STT variable-cost line is corrected accordingly:

- **Use Chirp_2's rate, ~$0.016/min (GCP STT v2, [V2-SECONDARY] — re-price
  against the GCP console before relying on it for a budget decision),
  not the AWS Transcribe $0.024/min placeholder.**
- Re-run the worked example: STT at 20% of checks carrying audio, avg 2
  min: `0.2 × 2 × $0.016 = $0.0064` (previously $0.0096 at the AWS
  Transcribe placeholder rate) — **blended cost per submitted check
  revises down to ≈ $0.019**, list price, uncached.
- Note for the record: ADR-0005 (line ~102, written between Round A's
  provider benchmark landing and this correction) states a *different*
  correction — "~$0.00225/min (Gemini) not $0.016/min (Chirp assumption)"
  — asserting Gemini as the cheaper default. That line predates Round A's
  result and is itself now stale per Round A's own findings recorded
  immediately below it in the same document (Chirp_2 won on WER and on
  the silent-failure safety check; Gemini did not). ADR-0005 is owned by
  a concurrent agent and is not edited here — this correction is recorded
  on the cost-model side only, so a reader of *this* ADR isn't misled by
  the superseded Gemini-default assumption. If ADR-0005's own text is
  later reconciled, re-check this section against it.
- Treat both the $0.016/min Chirp_2 figure and this revised $0.019
  blended estimate as **provisional** pending ADR-0005 Round B (Sheng,
  code-switched, and noisy/crowd audio — none of which Round A's clean
  FLEURS clips tested) and pending the still-[GAP] advocate retainer,
  which remains the single largest unknown fixed cost in this model.

---
## Amendment (two-engine pivot, 2026-10-04) — the autonomous fetch engine adds a baseline cost line

**Status:** Accepted direction (owner-approved pivot 2026-10-04). Additive; the existing cost lines and runway model stand, with one new variable-cost line to model.

- **New cost line: autonomous fetch-engine spend** — LLM claim-density pre-filter + verify passes on fetched candidates, STT on the compliant subset, QStash fetch polls, and **X API v2 metered reads (~$0.005/read, ~2M/mo cap)**. Unlike submission spend it has no user throttle, so it is bounded structurally (ADR-0032 §4 caps + ADR-0011 per-engine breaker), not by demand. YouTube (free quota) and PesaCheck/Africa Check (free open data) carry the primary fetch load, keeping the baseline near-zero; X is the only metered discovery source and is budget-capped.
- **The dedup/content-addressed cache (ADR-0017) is the dominant cost control** under autonomy: a viral claim observed 500× across submissions and fetches is verified and paid **once**. The STT unit cost correction (Chirp_2/Gemini, ADR-0005) and this amortization keep the modelled variable cost bounded even as auto-publish volume rises. Advocate retainer + media-liability insurance (ADR-0008 Phase-1 gate) remain the larger fixed-cost [GAP] and now matter more given raised exposure.
