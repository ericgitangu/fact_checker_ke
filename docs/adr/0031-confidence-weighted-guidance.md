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

---
## Amendment (two-engine pivot, 2026-10-04) — AUTO-PUBLISH IS THE DEFAULT; human role shifts to async auditor

**Status of this amendment:** Accepted direction (owner-approved product pivot 2026-10-04). **Additive and superseding-in-place:** it flips the *operating default*, encodes a configurable per-tier spectrum, and reframes calibration as a quality ramp. The output model, risk tiers, framing ban, flywheel, kill-switch and the *legal honesty* about disclaimers are all **retained unchanged**. Where this amendment supersedes earlier text, the earlier text is kept on the record and marked.

### Why the flip
The pivot (ADR-0001/0002/0032) makes the product **self-sufficient and near-real-time**: the fetch engine auto-ingests and the pipeline must auto-publish, or the product does not exist as pivoted. The original scaffold shipped with **auto-publish OFF by default** (see the Implementation-status ledger: *"auto-publish OFF by default"*, and the Delegation note: *"auto-publish stays OFF until calibration lands"*). **Both of those lines are now superseded** by this amendment.

### The new operating default
> **Auto-publish is the DEFAULT operating mode — caveated and tiered.** _(Supersedes "auto-publish OFF by default" / "stays OFF until calibration lands".)_

Every published assessment carries the ADR-0033 standing caveat and the ADR-0023/§"output model" claim-attributed framing. The question is no longer *whether* to auto-publish but *in which framing and with what audit*, per risk tier.

### The configurable per-tier spectrum (owner decision: "hybrid — all three")
Tier C (named living person, hard-negative imputation — the highest-risk slice) is a **configurable spectrum supporting all three handling modes**, not a single behaviour:
- **(a) Caveated open-question + async audit — DEFAULT for Tier C.** Auto-publishes as a **claim-attributed open question** ("the evidence we found does not support X — here's why; [named person] has a right of reply"), **never an indictment**, always weighted + sourced + caveated (ADR-0033 §E). A human **audits it asynchronously** (sampling, after publish), not before. This is the default because it is the least-exposed framing that still ships autonomously.
- **(b) Fast-track human tap — available as a stricter configurable mode for Tier C.** The 30-second pre-publish confirm from the original Decision, selectable per-source/per-topic when the exposure warrants it (e.g. a specific high-risk entity, an election-silence window). Stricter than (a), still fast.
- **(c) Plain caveat — the floor, for Tier A/B.** Low/medium-risk assessments auto-publish with the standing caveat at their calibrated threshold (τA/τB), as the original Decision already specified.

Which mode applies to which (tier, entity, topic, window) is **configuration**, audit-logged, advocate-referenced where it relaxes exposure — not a code change.

### Calibration becomes a QUALITY RAMP, not a blocking gate
> _(Supersedes hard-constraint 1's "No calibration ⇒ nothing above Tier A auto-publishes" / "Until then, Tiers B and C stay fully human-gated" as the operating posture.)_

The system **starts conservative and loosens as the flywheel proves out** — it does **not** sit fully-human-gated until a calibration artifact appears. Concretely:
- Auto-publish is on across tiers from the start, at **deliberately conservative initial thresholds** and, for Tier C, in the **least-exposed framing (mode a)**.
- As calibration data accumulates (the flywheel), thresholds **loosen** and sampling-audit rate **shrinks** — earned by measured precision, exactly the "size of the human slice is an *output*, not a fixed policy" principle, now applied to *audit rate* rather than *approval gate*.
- Calibration (reliability curve + ECE) is still **measured and reported**; it now governs *how fast the ramp loosens*, not *whether anything ships*.

### The human role: BLOCKING APPROVER → ASYNC AUDITOR (shrinking %)
_(Supersedes hard-constraint 1's blocking-gate framing; see ADR-0004 and ADR-0025 amendments for the operational half.)_
The editor no longer stands between draft and publish for the majority of output. They **sample published assessments after the fact**, at a rate that is high early (pilot, conservative) and **shrinks as calibration proves out**, feeding corrections back into the flywheel. Tier-C mode (b) is the one place a pre-publish human tap remains, and only when configured.

### What is PRESERVED unchanged (the legal honesty)
The two hard constraints are **re-expressed, not abandoned**:
1. **Risk-weighting stays mandatory and Tier C stays special.** A caveat **reduces but does not erase** named-person defamation exposure (ADR-0008; *Walters v. OpenAI* exonerated only private, non-published output). So **Tier C defaults to claim-attributed open-question framing (mode a)** and **relaxing it further — toward any declarative person-directed statement, or dropping the async audit — remains an explicit, advocate-signed, audit-logged decision** (irreversible-in-consequence). Auto-publishing in mode (a) is *not* such a relaxation; moving *below* mode (a)'s protections is.
2. **The framing ban holds.** No bare "[Name] lied" at any tier (ADR-0023). Confidence is the published weight; "what would change this" and sources always render.
3. **The kill-switch holds** (and now also governs the fetch engine, ADR-0032): flipping it off halts autonomous publishing within one propagation cycle.

### Trade-offs accepted (additive)
- **We are deliberately shipping named-person assessments autonomously under a caveat whose legal shield is partial** (ADR-0033 residual risk). Accepted as a conscious pilot posture with Tier-C mode-(a) framing, async audit, advocate retainer, media-liability insurance (ADR-0008) and kill-switch — not as a claim that the exposure is gone.
- **Async audit catches errors *after* publish, not before.** A false Tier-C assessment can be live before a human sees it; mitigation is the least-exposed framing + fast correction (ADR-0025) + kill-switch, not prevention.
- **The quality ramp can be loosened too fast.** The cadence of loosening is itself a risk; it stays audit-logged and reviewable, and any defamation complaint reverts it (review trigger).

### Acceptance tests (additive)
| ID | Behaviour | Status |
|---|---|---|
| AT-0031-6 | With a calibration artifact absent, the system still auto-publishes at conservative defaults (auto-publish is the default mode), rather than falling back to a full human gate — superseding the old "nothing above Tier A auto-publishes without calibration" behaviour. | RED |
| AT-0031-7 | Tier C defaults to mode (a): an auto-published claim-attributed open-question assessment that is never a declarative person-directed statement, always carries the standing caveat + sources + confidence, and is queued for async audit. | RED |
| AT-0031-8 | The Tier-C handling mode is configurable (a/b/c) per tier/entity/topic/window; selecting mode (b) inserts a pre-publish human tap; any config change that reduces Tier-C protection below mode (a) is rejected without an audit-logged advocate-signoff reference. | RED |
| AT-0031-9 | The human-audit sampling rate is a function of measured calibration (an output, not a constant): improving calibration lowers the sampled %, degrading calibration raises it; the editor is an async auditor, not a pre-publish approver, for Tier A/B and Tier-C mode (a). | RED |
| AT-0031-10 | Flipping the kill-switch halts all autonomous publishing (fetch- and submission-sourced) within one propagation cycle while read paths stay live. | RED |
