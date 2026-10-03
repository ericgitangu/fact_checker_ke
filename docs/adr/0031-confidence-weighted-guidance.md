# ADR-0031: Confidence-weighted guidance and data-flywheel threshold evolution

**Status:** Proposed (owner-initiated 2026-10-03) · **Date:** 2026-10-03
**Refines:** ADR-0004 (verification pipeline / human gate), ADR-0023 (adversarial AI / admission thresholds), ADR-0005 (STT / custom models). Additive — it sharpens the human gate, it does not delete it.

## Problem
Does fact_checker_ke publish **binary verdicts behind a permanent human wall** (ADR-0004 as written), or **calibrated confidence-weighted guidance the reader judges** — and how does the human-review slice *evolve* as the system learns, without betting the company on the defamation it's designed to avoid?

## Context
The owner wants Google-search-style evolution: ship useful automation now, get better with data and usage, add ML engines and eventually self-trained models, and clamp thresholds as robustness grows. The constraint is that fact-checking errors are **high-stakes** (defamation — verified KES 6–20M awards, ADR-0008) in a way search-ranking errors are not, and that **a disclaimer does not absolve a published defamatory falsehood about a named person** (ADR-0008 legal position; *Walters v. OpenAI* only exonerated private, non-published output).

## Options
1. **Binary verdicts + permanent human gate (ADR-0004 unchanged)** — ✓ safest, most credible; ✗ doesn't scale, no automation velocity, can't grow into the owner's roadmap, editorial capacity is the hard ceiling (ADR-0025).
2. **Fully automated binary verdicts, "research-purposes" disclaimer as the shield** — ✓ maximum velocity; ✗ disclaimers don't absolve defamation, and a disclaimer strong enough to shield ("don't rely on this") destroys a fact-checker's reason to exist. Reputational + legal self-harm.
3. **Calibrated confidence-weighted guidance + risk-tiered auto-publish + a data flywheel that shrinks the human slice as measured calibration improves** — ✓ velocity on the low-stakes majority, safety on the high-stakes minority, user agency, and an *auditable* evolution path; ✗ needs calibration infrastructure up front and a two-axis (confidence × risk) policy that is more complex than one gate.

## Decision: Option 3

### The output model
Every result is an **assessment**, not an accusation: `{support_level, calibrated_confidence, evidence[], what_would_change_this, framing}`. Rendered as *"the evidence we found does/doesn't support this claim — confidence X, here are the sources, you decide."* The pipeline already emits `confidence` and `what_would_change_this` (ADR-0004 step 6); this makes the **confidence the published weight** and bans the bare person-indicting verdict ("[Name] lied") in favour of claim-and-evidence framing (ADR-0023 framing rule).

### Risk tiers (the publish-policy axis)
`risk = f(names a living person?, severity of imputation [crime/dishonesty vs. inaccuracy], reach)`.
- **Tier A — low:** general, numeric, or provenance claims, no named person → **auto-publish** at calibrated confidence ≥ τA.
- **Tier B — medium:** names a person but the finding is framed non-defamatorily ("claim unsupported by [source]") → **auto-publish** at a higher τB, with framing enforcement + an async right-of-reply notice.
- **Tier C — high:** a hard-negative finding that unavoidably imputes dishonesty/criminality to a *named living person* → **always a human confirm** (the 30-second tap), regardless of model confidence, until a logged policy decision + advocate sign-off says otherwise.

### Calibration (the first ML engine, not the last)
Raw LLM confidence is **not** calibrated. Before any τ gates auto-publish, confidence must be mapped to true correctness probability (isotonic/Platt fit on a held-out eval set), reported as a reliability curve + ECE. Each tier's τ is then set from the *calibrated* curve to hit a target precision (e.g. auto-publish only where calibrated P(correct) ≥ 0.97 for that tier). **No calibration ⇒ nothing above Tier A auto-publishes.**

### The data flywheel (how it evolves, à la Google)
Every published check + every editor correction + user agree/dispute signals + right-of-reply outcomes become a **labeled dataset** (the retention/audit tables, ADR-0021). On a cadence: (a) re-fit calibration, (b) re-tune τ per tier, (c) fine-tune models (Sheng/Swahili STT via the Apache XLS-R path, a claim/opinion classifier, a credibility model — ADR-0005/0004 seeds). **The size of the human slice is an *output* of measured precision, not a fixed policy** — the gate earns its own shrinkage with evidence.

## Two hard constraints (non-negotiable)
1. **Calibration-before-thresholds.** A confidence number may gate auto-publish only after it is measured-calibrated on held-out data. Until then, Tiers B and C stay fully human-gated.
2. **Risk-weighting is mandatory.** Thresholds are per-tier. **Tier C can never drop to zero human review on model confidence alone** — relaxing it is an explicit, advocate-signed, audit-logged policy decision, because the exposure is legally irreversible in consequence even if reversible in code.

## Trade-offs accepted
- Slower to "full automation" than the owner's instinct — the named-person hard-negative slice stays gated longest.
- Calibration + the flywheel are upfront engineering before the automation dividend lands.
- A two-axis policy (confidence × risk) is more complex to reason about and test than a single on/off gate.

## Irreversible / hard to undo
A published false defamatory verdict cannot be recalled from the internet or screenshots. Therefore **loosening the Tier-C gate is flagged irreversible-in-consequence**: it requires advocate sign-off, is audit-logged, and is reversible in code only going forward.

## Review triggers
- The eval set reaches the agreed labeled-item count with a measured reliability curve → set initial τA/τB.
- Any defamation complaint or legal notice → immediate tier/threshold review.
- Quarterly threshold + calibration review as the flywheel accumulates data.

## Delegation notes (for the implementing pass)
Implement: surface `calibrated_confidence` + `what_would_change_this` in the published payload and UI; a `risk_tier` classifier at draft time; a publish-policy table keyed on (tier, calibrated_confidence); a calibration harness in `services/pipeline/app/eval`; keep Tier C human-gated in code; auto-publish stays OFF until calibration lands. Do not re-litigate the tiered model.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0031-1 | A published result carries `calibrated_confidence` + `what_would_change_this` + cited evidence, and never renders a bare "[Name] lied" (framing enforced) | RED |
| AT-0031-2 | Calibration is measured on a held-out eval set (reliability curve + ECE reported); with no calibration artifact present, Tier B/C auto-publish is disabled | RED |
| AT-0031-3 | The publish-policy table auto-publishes Tier A ≥ τA, holds Tier C for human confirm regardless of confidence | RED |
| AT-0031-4 | An editor correction and a user dispute are persisted as labeled training/eval rows (flywheel capture) | RED |
| AT-0031-5 | Any change to a tier threshold is audit-logged and requires an explicit policy flag; Tier-C relaxation additionally records an advocate-signoff reference | RED |
