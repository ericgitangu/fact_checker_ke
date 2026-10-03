# ADR-0004: Claim verification pipeline — credibility-aware RAG and human-gated verdicts

**Status:** Proposed · **Date:** 2026-10-03

## Problem
We need to turn transcripts and text into checkable claims and ground them against authoritative sources. The output has to be credible enough to be "the source of truth" without exposing us to defamation risk or automated error.

## Evidence
- Naive retrieve-then-verify RAG handles conflicting evidence badly. Majority voting fails when misleading sources outnumber reliable ones, and retrieving more documents (10 vs 5) did not help **[V, single IJCAI-25 study]**.
- Injecting **source-credibility context at generation time**, together with "discern unreliable sources" reasoning, gave the best results (LLaMA-3.1 SBA-ens 76.76 vs SF 67.10). Filtering by credibility *at retrieval* can remove crucial counter-evidence **[V]**.
- Google Fact Check Tools API `claims:search` supports text query, `languageCode=sw`, `reviewPublisherSiteFilter` (for example pesacheck.org or africacheck.org), `maxAgeDays` and image search. It is alpha with no SLA **[V]**.
- ClaimReview rich results were dropped from Google Search in June 2025. The markup is still used by Fact Check Explorer and the API **[V]**.

## Decision (proposed)
**Pipeline stages.** Each stage is an event (ADR-0009) and is idempotent on its content hash.

1. **Normalize.** Produce transcript or text, then segment it with timestamps. ~~(applies uniformly to any submitted URL)~~ _(superseded — for third-party YouTube/TikTok video there is no transcript: the submitter's quote + timestamp is the input, carrying `attribution: unverified` until an editor confirms it; see "Red-team amendments" and ADR-0002's decision update)_
2. **Claim detection.** Use a cheap model (ADR-0011) to sort statements into *checkable factual claim*, *opinion*, *prediction* or *rhetoric*. Only checkable claims continue. This is how we "don't dismiss personal opinions".
3. **Claim dedup.** Embed the claim (pgvector) and match it against existing claims. A hit reuses the existing check, which is the biggest cost lever.
4. **Retrieve.** Pull from three places:
   - our published checks
   - the Fact Check Tools API, with attribution
   - a curated corpus covering KNBS statistics, Kenya Law (court rulings and Acts), the Hansard, IEBC, Treasury and CBK releases, gazette notices, and outlet RSS
5. **Credibility registry.** Keep a hand-curated table: `source -> tier, notes, last_reviewed`. It is injected into the verdict prompt as context, **never used as a hard filter [V]**. No off-the-shelf registry covers Kenyan outlets **[I]**, so we build it ourselves.
6. **Draft verdict.** Use a strong model with structured output: `{rating, rationale, citations[], confidence, what_would_change_this}`. The rating scale is `True / Mostly true / Misleading / False / Unproven / Not checkable`.
7. **Human review gate.**
   - Drafts show as "AI-assisted analysis" to the submitter only.
   - A verdict becomes *published* (public page, ClaimReview JSON-LD, outbound post) only after an editor approves it.
   - Named-person claims always need review (ADR-0008).
8. **Publish.** Produce a canonical page and ClaimReview JSON-LD. Publish ClaimReview for interoperability, not SEO **[V]**.

**Model families named in the brief:**
- **RAG**: yes, as above.
- **CNNs**: only inside media detectors (ADR-0006), not as a custom training effort.
- **GNNs** for propagation and coordinated-network detection: deferred to Phase 3. We lack lawful access to the share graph (ADR-0002), and there is no labelled Kenyan dataset **[I]**.

## Trade-offs accepted
- Human review limits throughput. We trade volume for credibility and legal safety.
- The evidence base for the RAG design is one paper tested on older open models with English data. The design is sound, but we should build our own eval set of 100 or more Kenyan claims before trusting accuracy numbers.

## Review trigger
Revisit if the eval set shows draft-verdict agreement with editors above an agreed threshold. Then consider auto-publishing low-risk categories, such as numeric statistics checked against KNBS.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #5-#8 (blocker/high severity, pipeline-baseline wave).

- **Step 7 (human review gate), amendment #5 [blocker]:** A draft involving a named person shows evidence and sources only, with `rating: null`, to the submitter. Ratings render only after editor approval. (Closes red-team C-2: a draft must never be treated as a de facto published verdict for defamation purposes.)
- **Step 1/ADR-0002, amendment #6 [blocker]:** A user-supplied quote carries `attribution: unverified`. The editor confirms it against the embed at the timestamp before publishing. The UI states: *"We checked the quote you provided, not the video audio."* (Closes red-team C-1: fabricated-quote attack.)
- **Step 6 (draft verdict), amendment #7 [high]:** Citations must reference retrieved `doc_id`s only. Quoted spans are verified against archived snapshots before a draft is accepted. Submitted and retrieved text goes into delimited, untrusted blocks with no tool access, and the output is schema-validated. (Closes red-team C-6: hallucinated/misquoted citations; contributes to C-12/adversarial-AI surface.)
- **Step 3 (claim dedup), amendment #8 [high]:** Reuse requires similarity ≥ τ **and** matching negation, numbers, entities and dates, plus a `valid_as_of` check. (Closes red-team C-10: negation-collision and stale-statistic reuse.)

## Acceptance tests

| ID | Behaviour | Status |
|---|---|---|
| AT-0004-A | A user-supplied quote on a named person gets `attribution: unverified`. No rating is rendered until an editor confirms the quote against the embed at the timestamp. | RED |
| AT-0004-B | A draft that involves a named person returns evidence and sources only, with `rating: null`, to the submitter. | RED |
| AT-0004-C | Every `citations[].doc_id` is in the retrieved set, every quoted span substring-matches the archived snapshot, otherwise the draft is rejected. | RED |
| AT-0004-D | Negation, number, date and entity mismatches block claim-dedup reuse. Reused checks show `valid_as_of`. | RED |
| AT-0004-E | The 100-claim eval set includes at least 30 Sheng items. Claim/opinion F1 must clear a threshold before launch. At least 10% of dropped items are sampled to editors. | RED |
