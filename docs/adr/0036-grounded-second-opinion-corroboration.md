# ADR-0036: Grounded second-opinion corroboration gate

**Date:** 2026-10-07 **Status:** accepted (shadow-mode, lift deferred)

**Amends:** ADR-0031 (adds second-opinion *agreement* as a dimension of the
calibration map + a shadow→gated ramp), ADR-0023 (grounded search output is
untrusted content; its citations are an *agreement signal only*, never
auto-ingested as evidence without the §2 citation-integrity check), ADR-0032
(reuses the per-engine cost breaker).

## Problem

Should a Google-grounded Gemini verdict act as an INDEPENDENT second gate whose
agreement/disagreement with the primary (Claude) draft adjusts the *calibrated*
confidence — enough to flip a held Tier-A/B near-miss to auto-publish — and how
does agreement become an empirical confidence % WITHOUT breaking ADR-0031 hard
constraint 1 (calibration-before-thresholds)?

**Mechanism note.** The consumer "Google AI Mode" in Search has no public API.
The programmatic equivalent is the **Gemini API with Google Search grounding**
(or Vertex AI grounding on GCP), which returns an answer plus grounding
citations. This design is built on that; scraping the consumer UI is ruled out
(no API, ToS, and it would turn page content into a prompt-injection surface).

## Options

1. **Inside the verify-hop draft call** (one combined Claude+Gemini prompt) — ✓
   one round-trip / ✗ destroys independence (the whole point), couples two
   vendors in one failure domain, can't be sampled to the decision boundary.
2. **A new synchronous corroboration stage, sampled to the decision-boundary
   slice, feeding `finalize_publish` before `decide_publish_policy`** — ✓ keeps
   Claude's draft independent + cheap, enters confidence through the EXISTING
   calibration map (policy fn untouched), naturally bounded to items a lift
   could flip / ✗ adds a metered call + latency on that slice.
3. **Fully async second gate after publish (audit-only)** — ✓ zero added
   latency / ✗ cannot flip a *held* draft to auto (the actual ask); only
   re-audits what already shipped.

## Decision

**Build the thin version of Option B, shipped in SHADOW mode.** Add the
corroboration stage, the activate-on-keys Gemini client, and the agreement
feature on the wire — but contribute **zero** confidence lift until
per-stratum correctness is measured on held-out flywheel labels. The lift is
gated by BOTH an explicit shadow flag (`CORROBORATION_SHADOW_MODE`, default on)
AND the absence of a fitted per-stratum artifact — either alone forces lift = 0.

## The confidence model (the core)

Agreement is a **measured feature, not a confidence.** We do NOT average two
models' self-reported confidences — two uncalibrated numbers average to a third
uncalibrated number, and `CheckSchema.calibratedConfidence` is contractually
*"measured-calibrated P(correct), NOT the raw LLM confidence"*. Instead:

1. **Record, don't blend.** For every corroborated boundary item, capture
   `agreement_state ∈ {agree, disagree, no_second_opinion}` alongside the
   draft's raw confidence on the flywheel.
2. **Stratify.** Fit a SEPARATE isotonic (PAVA) curve per `agreement_state`
   (`fit_stratified_calibration`), reusing the existing calibration harness. The
   calibrated confidence for an item is the value of its stratum's curve at the
   raw confidence.
3. **The empirical %** is then *exactly* the measured gap between the "agree"
   curve and the baseline on held-out labels: "among boundary drafts rated R at
   raw-confidence [lo,hi] where the grounded gate agreed, what fraction were
   actually correct?" That fraction IS the calibrated confidence.
4. **Release gate.** The lift turns on only when (a) ≥ a minimum N labelled
   items PER stratum (incl. Swahili/Sheng, per ADR-0023's eval-gate discipline)
   and (b) a reported per-stratum ECE at/under the ADR-0031 reference clear —
   at which point the stratified artifact is written and `CORROBORATION_SHADOW_MODE`
   is set false. Until then `apply_stratified_calibration` has no artifact to
   load, so lift = 0 by construction (same "absence gates it" discipline as
   today's `calibration_present`).
5. **Direction + Tier-C clamp.** Agreement may RAISE calibrated confidence;
   disagreement may only LOWER it (`min(baseline, stratum)`). For **Tier C the
   lift is never applied** — corroboration contributes nothing to a named-person
   item's auto decision.

## Trade-offs accepted

1. A metered Gemini call + latency on the boundary slice (bounded by sampling +
   activate-on-keys + the per-engine cost breaker), synchronous before the
   publish decision.
2. No automation dividend until enough per-stratum labels accumulate —
   shadow-first defers the payoff and pays per-call cost first (same shape as
   ADR-0031's calibration ramp).
3. Correlated-error blind spot: Claude and Gemini may share training biases, so
   "agreement" overstates independence; the measured agreement-vs-correctness
   rate captures most of it, but a shared confident error is residual —
   mitigated by the Tier-C clamp + retained async human audit.

## Failure modes & rollback

- **10x:** grounding rate-limits/latency-spikes on the boundary slice → the call
  times out → fail-closed to `no_second_opinion` → would-be flips stay held →
  editor queue grows (degrades to *slower*, never *wrong*). A mis-set sampling
  band corroborating everything is caught by the cost breaker's hard-stop + the
  boundary band.
- **Rollback:** unset `GEMINI_API_KEY` → Fake → zero calls, zero lift (pure
  no-op). Or delete the stratified artifact / set shadow on → baseline curve.
  The global auto-publish kill-switch still halts all auto-publish independently.

## Review trigger

Per-stratum N + ECE clear on the flywheel labels → write the stratified artifact
and flip `CORROBORATION_SHADOW_MODE=false` (Phase 2). Revisit the sampling band
and the correlated-error assumption at that review.

## Scope shipped now vs deferred (honest tech-debt)

**Shipped (pipeline, inert without the key):** the Corroboration protocol +
`FakeCorroboration` + `RealGeminiCorroboration` (grounding) + activate-on-keys
factory; the boundary-sampled `run_corroboration` stage with cost-breaker
pre-spend + fail-closed; `finalize_publish` wiring with the shadow guard, the
Tier-C clamp, and the directional (agree-up / disagree-down) stratum lift;
`fit_stratified_calibration` / `apply_stratified_calibration`; the agreement
feature on the `/hops/verify` wire (`VerifyResult.corroboration`,
`PublishDecisionPayload.corroboration_state`). Tests cover activate-on-keys,
shadow-zero-lift, fail-closed, cost-breaker hard-stop, sampling bound, the
Tier-C clamp, and a phase-1 lift with an injected artifact.

**Deferred to Phase 2 (when the key is on and data collection begins):**
persisting `agreement_state` (+ raw confidence) per check for the flywheel join
(a nullable `checks` column + API-orchestrator write), the stratified fit run
against production labels, and the UI transparency chip. These do not weaken the
zero-lift safety guarantee (no key ⇒ no agreement data to persist; shadow +
artifact-absence ⇒ no lift regardless).

**The single most important thing:** agreement contributes **zero** until
P(correct | raw_confidence, agreement_state) is measured per stratum on held-out
labels with a reported ECE — never a raw-confidence blend, and never a path that
moves a Tier-C named-person item toward auto-publish.
