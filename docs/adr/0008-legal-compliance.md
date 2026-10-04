# ADR-0008: Legal entity, ODPC registration and editorial policy

**Status:** Proposed · **Date:** 2026-10-03 · **Requires a Kenyan advocate's sign-off before acceptance**

## Evidence
- Under the DPA 2019, registering with the ODPC is the default for every data controller and processor, including those outside Kenya that process data of people in Kenya. The exemption needs **both** turnover under KES 5M **and** fewer than 10 employees, and it never applies to the mandatory sectors, which include political canvassing and direct marketing **[V]**. Whether a fact-checker or protest tracker falls into those sectors is **[I]**. Assume yes.
- CMCA ss.22-23 (false publication) were struck down (Mar 2026) **[U]**. The suspended 2025 s.27 provisions cover reputation-harming and "false, misleading" communications, with penalties up to KES 20M or 10 years **[U]**. Their current status is a **[GAP]**.
- Kenyan civil defamation exposure for "False" verdicts on named people **[GAP]**.
- IFCN takes 6-18 months to process, charges a US$350 fee, and requires a regular nonpartisan publishing record **[V]/[U]**.
- PesaCheck (Code for Africa) is the incumbent and publishes in English, French, Kiswahili, Amharic and Somali. Sheng is not listed **[V]**.

## Decision (proposed)
1. **Legal entity.** Incorporate a company, or use your startup's entity, and use it for Apple, Google, ODPC and banking. **Irreversible-ish:** app ownership transfers are painful.
2. **ODPC.** Register before user accounts or comments go live. Publish a privacy notice, apply data minimisation (no GPS, no contact sync) and appoint a DPO contact.
3. **Editorial policy, published on day one and modelled on the IFCN commitments:**
   - nonpartisanship
   - source transparency
   - funding transparency
   - methodology
   - corrections policy
   - **right of reply:** named persons get contact and a response window before a "False" verdict is published, except for urgent public-safety claims
4. **Rate claims, not people.** No "liar" scores or creator leaderboards. That is a defamation and harassment vector **[I]**.
5. **Credit and link out.** Never republish other fact-checkers' content in full. Quote, attribute and link **[V: API results are third-party verdicts]**.
6. **Partner, don't compete.** Approach PesaCheck and Africa Check about a Sheng/creator-content collaboration. That offers credibility borrowing before IFCN.
7. **Track record for IFCN starts now.** At least one published check a week from launch.

## Trade-offs accepted
Paperwork and slower publishing in exchange for survivability.

## Review trigger
Revisit on any legal opinion, any NC4 or ODPC correspondence, or when the DPA Amendment Bill 2025 passes.

---
## Research round 2 (2026-10-03): amendments for grooming

**Legal status (all [V2-SECONDARY] unless noted; primary judgment texts not retrieved):**
- **CMCA ss.22-23 (false publication):** struck down by the Court of Appeal on 6 Mar 2026 (BAKE v AG, Civil Appeal 197 of 2020). Reports say BAKE is heading to the Supreme Court. Whether that stays the ruling is unknown.
- **CMCA (Amendment) 2025:** s.27(1)(b),(c),(2) were suspended in Oct 2025. The final ruling (about 2 Jul 2026) reportedly struck down s.6(1) and s.27(1).
- **Defamation is the dominant risk.**
  - Recent awards **[V2-PRIMARY: kenyalaw.org]**:
    - *Dasani v Ochieng*: KES 20M (KEHC 3776, 27 Mar 2025)
    - *Muthaura v NMG*: KES 7.5M plus a takedown order (KEHC 2386, 6 Mar 2025)
    - *Mwau v NMG*: KES 6M (KEHC 3073, 6 Mar 2025)
  - **No Kenyan precedent covers a fact-checker's ratings.** This is first-mover legal exposure.
- **DPA s.52** journalism exemption may cover journalistic processing, but ODPC guidance suggests registration may still apply. Fees: micro/small KES 4,000, medium 16,000, large 40,000. Valid 24 months. The DPA Amendment Bill 2025 status is **[GAP]**.
- **No CA licence or MCK accreditation requirement was found** for an online-only, non-broadcast publisher. MCK accreditation ties to broadcast licence renewal **[GAP: confirm against Act text]**.

**Additions to the decision:**
- Every "False" or "Misleading" verdict on a **named person** gets a documented evidence file (sources, retrieval timestamps, archived copies) to support a justification (truth) defence. Archive sources at publish time.
- Use rating copy that rates the *claim*, with the reasoning shown ("The claim that X is false because KNBS 2025 shows Y"), so that rationale and evidence sit next to the label.
- Retain an advocate before the first named-person verdict.

**Questions for the advocate:**
1. Does the Mar 2026 CoA ruling on ss.22-23 bind now, or is it stayed pending the Supreme Court?
2. What is the current text and status of CMCA s.6(1) and s.27 after the Jul 2026 ruling? Has an appeal been filed?
3. Would a "False" or "Misleading" rating be treated as fact (justification defence) or opinion (fair comment) under Cap 36?
4. Does the DPA s.52 journalism exemption cover a fact-checking startup? Is registration still mandatory?
5. Does embedding a licensed broadcaster's live stream create derivative liability under KICA?
6. What is the exposure for republishing Public Order Act-notified protest details, including when a protest is later declared unlawful?
7. What is the status of the DPA (Amendment) Bill 2025?

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #10 (high severity).

- **Right-of-reply window fixed at 48h.** The existing decision text (point 3) names a "response window" without a number; this amendment fixes it at 48 hours minimum before a "False"/"Misleading" verdict involving a named person publishes.
- **Public-safety exception needs a recorded reason.** The existing "except for urgent public-safety claims" carve-out may only be invoked with the specific reason logged against the check (who invoked it, and why), auditable after the fact — this prevents the exception from becoming the default path for politically inconvenient verdicts.
- **Takedown and complaint SLA added:** a published check that receives a takedown demand or formal complaint gets an initial response within a defined SLA (to be set by the retained advocate; not lower than legal minimums).
- **Law-enforcement request policy** is required before any user data (submissions, IPs, account data) is disclosed to a law-enforcement or government request — this is a placeholder gate pending the forthcoming Data protection lifecycle ADR (see README pointer list); this ADR owns the *editorial* consequence (no disclosure without the policy existing), not the full DP design.
- **Media-liability insurance is a Phase 1 gate** — added to the editorial-policy rollout alongside ODPC registration and the retained advocate, given the defamation exposure evidenced in Research round 2 (KES 6-20M awards, no Kenyan precedent for a fact-checker's ratings).

## Acceptance tests

| ID | Behaviour | Status |
|---|---|---|
| AT-0008-A | A named-person publish is blocked without an evidence file, archived sources, a logged right-of-reply attempt and a window of 48h or more (unless the public-safety flag is set *with the reason recorded*). | RED |
| AT-0008-B | A check page rates a claim, never an account. The badge or embed carries the claim text and date. Per-account submission caps apply to any one target handle. | RED |

---
## Amendment (two-engine pivot, 2026-10-04) — auto-publish, autonomy, and the async right-of-reply

**Status of this amendment:** Accepted direction (owner-approved pivot 2026-10-04); still **requires advocate sign-off** — this amendment *raises*, it does not lower, the need for counsel. Additive: §1–7, the Research-round-2 additions, and the 48h/public-safety/takedown red-team amendments are all retained. **ADR-0033** now owns the full Terms/Privacy/caveat/indemnity draft; this ADR keeps the editorial-policy consequences.

### What the pivot changes for legal exposure
Auto-publish (ADR-0031) is now the **default** operating mode, and the **fetch engine** (ADR-0002/0032) publishes named-person assessments **autonomously, with no human in the submit loop**. This materially **increases** the defamation exposure this ADR is built around (verified KES 6–20M awards; no Kenyan fact-checker-rating precedent — first-mover risk). The mitigations are strengthened and made explicit, not relaxed:

- **The standing caveat (ADR-0033 §A) is part of editorial policy**, shown on every published assessment, claim-attributed, pilot-stage, AI-generated, sources-cited, right-of-reply linked. **It reduces but does not erase** named-person exposure — stated here as the ADR-0008 legal position, matching ADR-0031.
- **Right of reply becomes ASYNC for auto-published Tier A/B and Tier-C mode (a).** The 48h pre-publish window fixed by the earlier red-team amendment (point 3 / AT-0008-A) was built for the human-gated model. Under auto-publish it is **reframed, not deleted**:
  - Tier C **mode (b)** (configurable stricter mode, ADR-0031) retains the **pre-publish** 48h window.
  - Tier C **mode (a)** (default) and Tier A/B auto-publish in **claim-attributed / open-question** framing and provide an **async right-of-reply + correction path** (notice to the named person's public channel at/after publish, plus a prominent correction mechanism, ADR-0025). **`[ADVOCATE: confirm an async right-of-reply on a claim-attributed, caveated, open-question assessment is defensible for a named living person under Cap 36 — this is the single most important question raised by the pivot.]`**
- **The public-safety carve-out and takedown/complaint SLA are unchanged** and now also apply to auto-published items; a takedown demand on an auto-published assessment triggers the SLA and may trip the kill-switch (ADR-0031/0032).
- **Evidence file + source archival at publish time (Research round 2) now runs for auto-published items too** — autonomy does not remove the justification-defence record; it makes it mandatory per auto-published named-person assessment.

### Irreversible / legal-risk (additive)
An **auto-published** false defamatory assessment is public before any human reviews it (async audit catches it after, ADR-0031). This is the largest single risk the pivot introduces, flagged irreversible-in-consequence (ADR-0031/0032/0033 concur). Media-liability insurance (Phase-1 gate, above) and the kill-switch are load-bearing, not optional.

### Acceptance tests (additive)
| ID | Behaviour | Status |
|---|---|---|
| AT-0008-C | An auto-published named-person assessment (Tier A/B or Tier-C mode a) carries the ADR-0033 standing caveat, claim-attributed framing, cited+archived evidence file, and a working async right-of-reply/correction link — and is never a declarative person-indicting statement. | RED |
| AT-0008-D | Tier-C mode (b) retains the pre-publish 48h right-of-reply window (AT-0008-A behaviour); switching an entity/topic from mode (a) to a weaker-than-(a) posture is blocked without an audit-logged advocate-signoff reference. | RED |
