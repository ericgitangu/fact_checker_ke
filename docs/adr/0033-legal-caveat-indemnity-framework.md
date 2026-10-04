# ADR-0033: Legal caveat, Terms & Conditions, Privacy Policy and indemnity framework

**Status:** Proposed — **STARTER DRAFT, NOT LEGAL ADVICE** · **Date:** 2026-10-04 · **Requires a Kenyan advocate's sign-off before ANY of this text is published or relied on (ties to ADR-0008).**
**Builds on:** ADR-0008 (legal/editorial), ADR-0021 (data protection / retention / cross-border), ADR-0031 (confidence-weighted auto-publish is now the default), ADR-0032 (autonomous fetch engine), ADR-0023 (framing), ADR-0001 (pilot posture).

> ## ⚠️ Read this first — scope and disclaimer of this ADR
> This ADR records a **starter draft** of caveat/terms/privacy/indemnity language and *where it is surfaced*, so the implementing pass has something concrete to wire in behind a flag. **It is explicitly NOT legal advice and NOT a substitute for a Kenyan advocate.** No clause here is validated against Kenyan law (Defamation Act Cap 36, DPA 2019, CMCA and its 2025/2026 amendments, Consumer Protection Act 2012). Every bracketed `[ADVOCATE: …]` marker is an open question for counsel. **Nothing in this ADR may be published to users until the retained advocate (ADR-0008) reviews and signs off**, and the residual-risk section below states plainly what a caveat can and cannot do.

## Problem
The two-engine pivot (ADR-0001/0002/0031/0032) means the product now **auto-publishes** confidence-weighted assessments about named Kenyan political figures, **autonomously** (fetch engine, no human in the submit loop), in a polarized pre-election environment, as a **solo-founder pilot**. ADR-0008 already establishes the dominant risk as **defamation** (verified KES 6–20M awards; no Kenyan precedent for a fact-checker's ratings — first-mover exposure) and that **a disclaimer reduces but does not erase** named-person defamation exposure (ADR-0031: *Walters v. OpenAI* only exonerated private, non-published output). The owner wants legal indemnity **engrained** in (a) the standing caveat shown on *every* published assessment, (b) the Terms & Conditions, and (c) the Privacy Policy — including the data-collection-as-training-moat consent (ADR-0021). This ADR specifies that language as a reviewable draft and names, honestly, what it does not buy.

## Context carried from the pivot
- **Format references (corrected 2026-10-04):** the house rating/framing style follows **Africa Check** (a documented multi-step verification process and a 6–7-point rating scale) and **PesaCheck** (headline pattern *"[VERDICT]: [claim] — [why]"*, claim-attributed). **Do not cite a "CNN Facts First" letter/numeric rating scale** — CNN Facts First has no formal rating scale; earlier framing conflated it with PolitiFact. CNN Facts First remains an inspiration only for *proactive monitoring + transparent, claim-attributed framing*, not for a rating scale.
- **Tier C default is claim-attributed open-question framing** (ADR-0031 Amendment): the caveat and the framing are the *same* defamation-mitigation instrument viewed from two angles — the caveat is the standing legal notice, the framing is the per-assessment wording.

## Options
1. **No standing terms; rely on the editorial policy (ADR-0008) alone.** Rejected: auto-publish + autonomy materially raises exposure beyond what a methodology page covers; no user agreement, no limitation of liability, no consent record for the training-data moat.
2. **Copy a generic SaaS T&C/Privacy template.** Rejected: generic templates miss DPA 2019 (ODPC, cross-border Part VI), Kenyan defamation specifics, the pilot/AI-generated nature, and the right-of-reply/correction obligation — and would give false comfort.
3. **A Kenya-specific caveat + T&Cs + Privacy + indemnity set, drafted here as a starter and gated on advocate sign-off, with the standing caveat engrained in every published assessment and the pilot/AI posture stated honestly. Recommended** — explicitly as a *draft to be reviewed*, not a finished shield.

## Decision: Option 3 (starter draft, advocate-gated)

### A. The standing caveat (shown on EVERY published assessment — fetch- or submission-sourced)
Short form (always visible on the assessment card/badge/embed, and in every outbound post — ADR-0003/0023):

> **AI-assisted assessment · pilot · not a verdict on any person.**
> We assess the **claim**, not the person. This is a confidence-weighted, AI-generated analysis for **research and educational purposes**, published in a **pilot** stage. It is **not a statement of fact about any individual, not legal or professional advice, and carries no warranty of accuracy or completeness.** Sources are cited; confidence is shown. If you are named here, you have a **right of reply and correction** — [contact link].

Long form (linked "About this assessment / methodology"): expands each element —
- **AI-generated & confidence-weighted:** produced by automated analysis; the confidence figure is the published weight (ADR-0031), not a guarantee; *"what would change this"* is shown.
- **Claim-attributed, never person-indicting:** framing per ADR-0023/0031 (Tier C = open-question). We follow an Africa-Check-style process and a PesaCheck-style *"[VERDICT]: [claim] — [why]"* headline; **we rate claims, not people** (ADR-0008 §4).
- **Research/educational purpose, no reliance warranty:** `[ADVOCATE: confirm this framing does not itself defeat the product's credibility while still limiting liability — the ADR-0031 tension.]`
- **Pilot stage:** methods and calibration are still being proven (ADR-0031 quality ramp); error rates are non-zero and disclosed.
- **Sources & right of reply:** every assessment links its sources and an archived evidence file (ADR-0008); named persons get a **right-of-reply and correction path** (see §D — async for auto-published Tier A/B, pre-publish for stricter Tier C modes).

The caveat text is **data, not hard-coded copy** (one source string, snapshot-tested like ADR-0021 AT-0021-5), so legal can revise wording without a code change and it cannot silently regress.

### B. Terms & Conditions (structure — starter draft)
1. **Who we are / pilot status** — legal entity (ADR-0008 §1), ODPC registration status, "this is a pilot" stated up front.
2. **Nature of the service** — AI-assisted, confidence-weighted, claim-attributed assessments for research/education; **not** professional, legal, financial, electoral or journalistic advice to act on. `[ADVOCATE: journalism/DPA s.52 interaction, ADR-0008 Q4.]`
3. **No warranty** — provided "as is", no warranty of accuracy, completeness, fitness or non-infringement, to the extent permitted by Kenyan law. `[ADVOCATE: Consumer Protection Act 2012 limits on "as is" for a free service.]`
4. **Acceptable use** — no using assessments to harass, defame, or incite; no scraping/redistribution beyond the cited-and-linked terms (mirrors ADR-0008 §5, ADR-0026 licence boundary).
5. **User-submitted content (submission engine)** — the submitter warrants they have the right to submit it; the submitter **indemnifies** us against claims arising from *their* submission (fabricated quotes, infringing uploads). `[ADVOCATE: enforceability of an indemnity from an anonymous/free user.]`
6. **Limitation of liability** — aggregate liability cap `[ADVOCATE: a free pilot's cap; whether Kenyan law permits excluding liability for the content we ourselves publish — note this is the clause least likely to hold for our *own* auto-published defamation; see Residual risk.]`
7. **Right of reply, correction & takedown** — the named-person reply/correction path and the takedown/complaint SLA (ADR-0008 amendments; ADR-0025 workflow), stated as a user-facing right, not just an internal policy.
8. **Governing law & dispute resolution** — Kenyan law; forum `[ADVOCATE]`.
9. **Changes & pilot termination** — we may change or end the pilot; material changes notified.

### C. Privacy Policy (structure — starter draft, operationalizes ADR-0021/0008 §2)
1. **Controller identity & DPO contact** (ADR-0008 §2).
2. **What we collect, per data class** — mirror the ADR-0021 retention table (submissions, drafts, uploads, tracker-route logs, waitlist, audit log) with its lawful basis and retention period each.
3. **Cross-border transfer** — the ADR-0021 disclosure verbatim: *"Your submission is processed on servers in the European Union"* (Neon/Upstash `eu-central-1`); `[ADVOCATE: DPA Part VI basis — SCCs/adequacy/consent, ADR-0021 open.]`
4. **Data-collection-as-training-moat consent (owner requirement, ties to ADR-0021/0031 flywheel)** — a **specific, separate, opt-in-or-clearly-disclosed** consent that submissions, corrections and agree/dispute signals may be retained and used to **improve and train** our models (the ADR-0031 data flywheel / ADR-0005 Sheng-STT moat). This must be:
   - **granular and severable** from the act of submitting (DPA 2019 consent must be freely given, specific, informed — `[ADVOCATE: can a free service condition submission on training consent, or must it be optional?]`);
   - **honest about human review** of training data `[ADVOCATE]`;
   - **excluded for special-category / protest-related content** unless separately justified (ADR-0021 bars unpaid-tier processing of such content; training reuse is a higher bar, ADR-0005);
   - **revocable**, with revocation flowing to the DSAR path (ADR-0021).
5. **Minimisation** — no GPS, no contact sync (ADR-0008 §2); tracker-route IP redaction (ADR-0021 C-8).
6. **DSAR & law-enforcement** — the ADR-0021 DSAR flow and law-enforcement policy, as user-facing rights.
7. **Published checks are not erasable** — the justification-defence record (ADR-0008/0021) outlives erasure requests; stated plainly.

### D. Indemnification & limitation of liability (the engrained part)
- **User → us indemnity** (submission engine): §B.5 above — the submitter stands behind what they submit.
- **Us → user limitation** (§B.6): aggregate cap + "as is", **to the extent Kenyan law permits**.
- **The honest limit (the whole point of flagging this):** an indemnity from users and a limitation-of-liability toward users **do not run to a third party we defame.** A named politician we auto-publish a false assessment about is **not a party to our T&Cs** and is not bound by our caps or our users' indemnities. Their claim sounds in **defamation**, governed by ADR-0008, where **the caveat mitigates but does not erase** exposure (ADR-0031). The indemnity framework protects us from *user-origin* claims and *reliance* claims by users; it does **not** protect us from the core defamation risk the product's own auto-published output creates. See Residual risk.

### E. Tier-C interaction (ADR-0031)
Because Tier C (named living person, hard-negative imputation) defaults to **claim-attributed open-question framing + async audit** and can be configured stricter (fast-track human tap or hold), the caveat's *per-assessment* wording tightens with tier: Tier A/B carry the standing caveat as the floor; **Tier C additionally renders the open-question framing inline** ("the evidence we found does not support X — here's why; [named person] has a right of reply") rather than any declarative person-directed statement. Relaxing Tier-C framing further is an explicit, advocate-signed, audit-logged decision (ADR-0031 hard constraint 2) — the caveat does not license it.

## Trade-offs accepted
- **A caveat strong enough to limit liability risks undercutting credibility** (ADR-0031 option 2's trap). We accept a *calibrated* caveat (research/educational + confidence-weighted + claim-attributed) over a blunt "don't rely on this", and name that this is a balance counsel must tune, not a solved problem.
- **Conditioning the training-moat on consent may shrink the flywheel's input** if consent must be optional (DPA). Accepted: a smaller lawful dataset over an unlawful large one (ADR-0021).
- **Drafting legal text we cannot validate ourselves** creates a false-comfort risk. Mitigated by the loud STARTER-DRAFT gating and `[ADVOCATE]` markers throughout — but the risk is real and stated.

## Irreversible / legal-risk flags (explicit)
- **Auto-published defamation cannot be recalled** (ADR-0031/0032). The indemnity framework does not cure this; it is the single largest residual exposure and it *grows* with autonomy and auto-publish volume.
- **Publishing any of this text before advocate sign-off is itself a risk** — bad terms can be worse than none (e.g. an unenforceable "as is" that signals bad faith, or a consent clause that breaches DPA). Hence the hard gate.
- **The training-moat consent, once collected wrongly, taints the dataset** — a consent later found invalid may require purging training data derived from it (ADR-0021 irreversibility parallel).

## Residual risk (stated honestly, per ADR-0008 posture)
After all of the above is drafted, reviewed and published: **named-person defamation exposure is reduced, not eliminated.** The caveat, the claim-attributed framing, the confidence weighting, the right-of-reply/correction path and the evidence file together support a *justification (truth)* and *reasonable-publication* posture and reduce the odds and quantum of a successful claim — but with **no Kenyan precedent for a fact-checker's ratings** (ADR-0008), an **auto-published** false assessment about a named politician remains a live KES-6–20M-scale risk. The mitigations are real; the shield is not absolute. This is a pilot taken on with that exposure consciously, with an advocate on retainer and media-liability insurance as a Phase-1 gate (ADR-0008 amendment), a kill-switch (ADR-0031/0032), and Tier-C defaulting to the least-exposed framing.

## Review triggers
- **Advocate review of this draft** — the gating event; nothing publishes before it. Resolve every `[ADVOCATE]` marker.
- Any defamation/ODPC/takedown correspondence → immediate terms/caveat review.
- Any change to auto-publish tiers/thresholds (ADR-0031) that increases named-person auto-publish → re-review caveat + residual risk.
- DPA (Amendment) Bill 2025 passing, or a CMCA judgment on s.27, or first Kenyan fact-checker-rating case law (ADR-0008) → re-review.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0033-1 | Every published assessment (fetch- or submission-sourced, every tier) renders the standing short-form caveat on its card/badge/embed and in any outbound post; the caveat text comes from one source string and is snapshot/contract-tested so it cannot silently regress. | RED |
| AT-0033-2 | No T&Cs, Privacy Policy or caveat text is served to end users while the advocate-signoff flag is unset (the whole set is gated); unsetting the flag hides it, it does not fall back to an unreviewed default. | RED |
| AT-0033-3 | The training-moat consent is a severable, specific, revocable record (not bundled into "submit"); revoking it routes to the DSAR path (ADR-0021) and excludes that subject's data from future training sets; protest/special-category content is excluded from training by default. | RED |
| AT-0033-4 | A Tier-C assessment renders claim-attributed open-question framing inline (never a declarative person-directed statement) in addition to the standing caveat (ADR-0031/0023); a snapshot test over rendered templates asserts no banned person-indicting phrasing ("[Name] lied") appears. | RED |
| AT-0033-5 | The published rating/framing follows the Africa-Check-style scale + PesaCheck-style "[VERDICT]: [claim] — [why]" headline; no "CNN Facts First rating scale" string or letter/numeric CNN scale is referenced anywhere in the product copy (regression guard against the corrected framing). | RED |
| AT-0033-6 | The Privacy Policy page states the EU cross-border processing disclosure verbatim and mirrors the ADR-0021 retention classes; the limitation-of-liability copy does NOT claim to limit liability toward non-party third parties (no false "this protects us from defamation" wording) — asserted by a copy-lint/snapshot test. | RED |

---
**See ADR-0008** (editorial/legal, advocate gate, right-of-reply 48h, defamation evidence), **ADR-0021** (data classes, cross-border, DSAR — the Privacy Policy operationalizes it), **ADR-0031** (tiered auto-publish, Tier-C framing, the caveat-vs-credibility tension), **ADR-0032** (autonomous fetch raises the exposure this framework addresses), **ADR-0023** (framing enforcement).
