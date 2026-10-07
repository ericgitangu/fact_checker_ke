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

## Phase-2 calibration run (2026-10-07) — signal proven, flip correctly withheld

Ran the golden-set harness (`app/eval/corroboration_calibration.py`, 55 curated
claims with independent verdicts, real draft + Vertex-grounded corroboration):

- **The agreement signal is strong and real.** Measured across runs: when the
  grounded gate AGREES the draft was correct ~82–89%; when it DISAGREES, ~3–9%;
  baseline ~26–33%. Agree-minus-baseline correctness lift **+0.50 to +0.63**.
  Disagree@high-confidence correctness was 0/N — agreement/disagreement is a
  far better correctness predictor than the draft's own confidence.
- **The flip was correctly WITHHELD** by the release gate. Two blockers, both
  real (not fixable by a looser bar):
  1. **The draft's raw confidence is bimodal** (~0.30 for inconclusive, ~0.80–
     0.99 when confident, almost nothing between), so an isotonic curve fit per
     stratum **saturates** — it maps everything ≥0.80 to ~1.0. A saturated curve
     would auto-publish any mid-confidence agreed draft, so the gate's
     non-saturation check rejects it. More data does NOT fix saturation.
  2. **The flip-relevant slice is tiny.** `agree AND raw_conf ≥ 0.95` was 100%
     correct but only **N=3** — statistically meaningless for an auto-publish
     decision.
- **Gate hardened** to catch this: agree stratum fitted (≥ min_per_stratum),
  positive lift, agree ECE ≤ 0.15, AND the agree curve not saturated at the
  boundary-band floor. The harness refuses to write an artifact unless all hold.

**Consequence for the lift model — IMPLEMENTED (agreement-gated FLOOR):**
isotonic-on-the-draft's-raw-confidence is the wrong shape for a bimodal signal,
so the lift model is now an **agreement-gated floor**: the agree stratum is a
non-saturating STEP — below a confidence `floor` (default 0.90) it contributes
0 (runtime `max(baseline, ·)` ⇒ no lift); at/above the floor it is the MEASURED
correctness of the `agree AND conf ≥ floor` slice. Agreement may only RAISE,
disagreement only LOWER (runtime `max`/`min`). The release gate requires that
flip-relevant slice to have ≥ min_per_stratum samples AND a measured correctness
clearing both the bar and the Tier-A auto threshold. Verified: on the saved
samples the slice measured 100% correct (ece 0.056) but N was still below bar, so
the gate correctly withheld — the only remaining blocker is **slice N**, grown via
a larger golden set and/or the live flywheel.

**Flywheel wired (the "robust over weeks" loop):** `checks.raw_confidence` +
`checks.agreement_state` are now persisted per check (migration 0021, set by the
API orchestrator from the verify response). Editor corrections already land in
`training_eval_labels` keyed by `check_id`, so fresh calibration samples are a
join — e.g. `SELECT c.raw_confidence, c.agreement_state, (c.rating = corrected)
AS correct FROM checks c JOIN training_eval_labels l ON l.check_id = c.id WHERE
c.agreement_state IS NOT NULL` → export to JSONL → feed the harness `--samples-in`.
As corrections accumulate, re-running the harness re-fits the floor and the flip
becomes one command; the editor's own work continuously sharpens the thresholds
(ADR-0031 data flywheel). Until the slice clears the bar: **shadow stays ON,
lift = 0.**

## Activation log (2026-10-07)

- **Ungrounded, free (Developer API key):** verified `gemini-3.8-flash` works on
  the free tier (`gemini-2.0-flash` retired); grounding 429s on free. Key stored
  in Secret Manager; pipeline rev 00018-7vq ran ungrounded + shadow + a dedicated
  ~$0.30/day corroboration spend lane.
- **Grounded, via Vertex AI (billed in the fact-checker-ke project):** enabled
  `aiplatform.googleapis.com`, granted `fcke-pipeline-runtime` `roles/aiplatform.user`,
  set `GOOGLE_GENAI_USE_VERTEXAI=true` + `GEMINI_CORROBORATION_GROUNDED=true`,
  model `gemini-2.5-flash` (Vertex serves this, not 3.8-flash), location `global`.
  Smoke-verified through the real client: the Dangote-refinery claim → `supported`
  (7 grounding citations), the COVID-microchip claim → `refuted` (15 citations).
  Cost stays near-0 by the grounding-aware pre-spend estimate ($0.04/grounded
  call) against the ~$0.30/day lane (~7 grounded calls/day). Vertex uses the
  Cloud Run SA via ADC — **no raw key, no new billing slot** (the separate
  Developer-key project is unbilled; `fact-checker-ke` is already billed on
  01C382). Still **shadow mode**: grounding improves the agreement DATA; it does
  not move any decision until the Phase-2 per-stratum artifact is fitted.

**The single most important thing:** agreement contributes **zero** until
P(correct | raw_confidence, agreement_state) is measured per stratum on held-out
labels with a reported ECE — never a raw-confidence blend, and never a path that
moves a Tier-C named-person item toward auto-publish.
