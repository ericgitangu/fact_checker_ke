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

1. **Normalize.** Produce transcript or text, then segment it with timestamps. _(superseded — this does not apply uniformly to every URL: for third-party YouTube/TikTok video there is no transcript: the submitter's quote + timestamp is the input, carrying `attribution: unverified` until an editor confirms it; see "Red-team amendments" and ADR-0002's decision update)_
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
| AT-0004-A | A user-supplied quote on a named person gets `attribution: unverified`. No rating is rendered until an editor confirms the quote against the embed at the timestamp. | GREEN (services/api; see "People & adjudication" implementation notes, 2026-10-03 — editor UI confirmation surface itself is apps/web territory, out of this change's ownership) |
| AT-0004-B | A draft that involves a named person returns evidence and sources only, with `rating: null`, to the submitter. | GREEN (services/api; see implementation notes) |
| AT-0004-C | Every `citations[].doc_id` is in the retrieved set, every quoted span substring-matches the archived snapshot, otherwise the draft is rejected. | GREEN |
| AT-0004-D | Negation, number, date and entity mismatches block claim-dedup reuse. Reused checks show `valid_as_of`. | GREEN |
| AT-0004-E | The 100-claim eval set includes at least 30 Sheng items. Claim/opinion F1 must clear a threshold before launch. At least 10% of dropped items are sampled to editors. | SCAFFOLD (GREEN on harness/sampling; 100-claim/30-Sheng threshold gate stays RED/open, see note) |

## Implementation notes (services/pipeline baseline, 2026-10-03)

Implements the pipeline-owned baseline: `POST /hops/analyze` (normalize via
pass-through for text, claim detection + language-ID + inline EN
translation in one Haiku-4.5-class call) and `POST /hops/verify` (embed via
`Embedder` Protocol, dedup gate, retrieve from `CheckStore` + Google Fact
Check Tools API, draft verdict via Sonnet-5.5-class structured output,
citation-integrity gate). See `services/pipeline/app/stages/analyze.py`,
`app/stages/verify.py`, `app/stages/dedup_guard.py`,
`app/stages/citation_guard.py`.

- **AT-0004-C** (citation integrity): `app/stages/citation_guard.py`
  enforces doc_id-in-retrieved-set and substring-match in code, never
  trusting the model. Tests: `tests/test_citation_guard.py`,
  `scripts/at/at-0004.sh`.
- **AT-0004-D** (dedup guard): `app/stages/dedup_guard.py` implements a
  deterministic (regex/keyword, not ML) negation/number/date/entity
  comparator for en + sw, gating reuse alongside the cosine-similarity
  threshold (`DEDUP_TAU = 0.92` in `app/stages/verify.py`, not yet tuned
  against a real eval set — tracked as tech debt). Tests:
  `tests/test_dedup_guard.py`, `tests/test_verify_hop.py`.
- **AT-0004-E** (eval harness): `app/eval/__main__.py` (`uv run python -m
  app.eval`, wired as moon task `pipeline:eval`) runs the 20-claim starter
  fixture set (`app/eval/fixtures/claims.jsonl`: 8 en / 7 sw / 5 Sheng) and
  prints per-class precision/recall/F1. This is a scaffold only: the
  100-claim/>=30-Sheng set and an agreed launch F1 threshold remain an
  **explicit open AT**, not faked. Sampling of dropped (non-checkable)
  items to editors at >=10% is implemented in
  `app/stages/analyze.py:_apply_editor_sampling` and covered by
  `tests/test_analyze_hop.py`.
- **AT-0004-A / AT-0004-B** (named-person gating, rating withheld
  pre-editor-approval): these are **services/api + editor UI** concerns
  (rendering rules, approval workflow) and are out of scope for this
  change's file ownership (`services/pipeline/**` only). The pipeline does
  its part: `app/stages/analyze.py` sets `attribution: "unverified"` for
  video-URL submissions and never fabricates a transcript (ADR-0004
  amendment #6); `app/stages/verify.py` computes a rating regardless of
  `named_person_involved` and documents, at the call site, that the API
  layer is responsible for withholding it pre-approval (amendment #5).
  Left RED here — flipped by the wave-2 integrator once services/api
  implements the rendering/approval rule.

**Deviations / tech debt (explicit, not buried):**
- `CheckStore` and the Fact Check Tools 24h cache are in-memory only
  (sqlite `:memory:` / dict-backed) for this baseline — the real Postgres
  (Neon) read lands at wave-2 integration (`packages/db` out of scope
  here). Process-lifetime only; acceptable for now since the pipeline
  worker itself is stateless/scale-to-zero between requests, but flagged.
- The dedup similarity threshold (`DEDUP_TAU`) and the entity/number/date
  extraction in `dedup_guard.py` are regex/keyword heuristics, not a
  trained NER model — deliberately conservative (over-reject, never
  under-reject) per the module's own docstring.
- `app/models/hop_requests.py` is explicitly marked TEMPORARY pending
  wave-2 reconciliation with the real `packages/core` event schemas
  (ADR-0017).
- The embedder (`intfloat/multilingual-e5-small` via fastembed, 384-dim)
  defaults to a deterministic `FakeEmbedder` unless
  `PIPELINE_USE_REAL_EMBEDDER=1` is set, keeping default test runs
  network-free; real-embedder behaviour is therefore only exercised when
  that flag is set (see `app/clients/embedder_factory.py`).

## Implementation notes, "People & adjudication" wave addendum (2026-10-03)

Landing AT-0004-A/AT-0004-B closes the services/api half of the gap the original note below ("owned by services/api + editor UI") called out:

- `packages/core/src/schemas/claim.ts`'s `Claim` now carries `namedPerson: boolean` and `attribution: "unverified" | "confirmed" | "not_applicable"` — one source of truth, mirrored into `packages/db`'s `claims.named_person`/`claims.attribution` columns.
- `GET /v1/checks/:id` (`services/api/src/routes/checks.ts`) redacts `rating` to `null` whenever a check is still a draft AND any of its claims is `namedPerson: true` — regardless of whether that claim's attribution is confirmed yet, since it's the editor's **approval** (not attribution confirmation alone) that makes a verdict publishable (ADR-0025 §5's gate, `services/api/src/lib/editorial.ts#approveCheck`).
- The editor-side confirmation action (`POST /v1/editor/claims/:claimId/confirm-attribution`) and the publish gate that refuses to approve a check with any `unverified` named-person claim are both new in this wave (ADR-0025's implementation notes have the full gate description).
- **Still owned by apps/web, not this wave:** the actual editor UI for watching the embed at the cited timestamp and clicking "confirm" — this wave only ships the API endpoint that records the confirmation; nothing here claims a UI exists.

## Implementation notes (security-hardening wave, 2026-10-04)

- **SEC-4: empty-analysis gap.** A video-URL submission with NO `quote` at all (the submitter pastes a link but no text) previously reached `run_analyze_hop` with `submitted_text` falling through to `""`, so the pipeline sent an EMPTY `<untrusted_submission>` block to the LLM and "analyzed" nothing — observed, concretely, as the fake-LLM-backed test crashing on `DetectedClaim`'s `min_length=1` validation (a real LLM might instead have fabricated a plausible-sounding claim from nothing, the worse failure mode). Two options were weighed: (a) make `quote` required at the `packages/core`/API boundary whenever `url` is a video-platform URL, or (b) short-circuit the analyze hop itself. **Chose (b), the short-circuit, per the task brief's own steer** — it works regardless of how reliably the platform (YouTube/TikTok/etc.) is detected as a "video" URL, whereas a schema-level requirement would depend on correctly classifying the URL at submission time, which is a weaker, more easily bypassed boundary (any URL shape not recognized as "video" would skip the requirement). `services/pipeline/app/stages/analyze.py:run_analyze_hop` now checks `is_video_url and not submitted_text.strip()` BEFORE building any prompt or calling the LLM, and returns a new typed outcome: `AnalyzeResult.needs_quote: bool = False` (`app/models/pipeline_io.py`) — `claims=[]`, `usage` a zero-cost `UsageRecord(model="none", ...)`, `attribution="unverified"` (still accurate: the empty-quote case is still "no verified transcript"). No `packages/core`/`submission.ts` schema change was made — `quote` stays optional there, by design, matching the chosen fix.
- `FakeLlmClient` (`app/fakes/fake_llm_client.py`) gained a `call_count` counter (test-support only) so the RED→GREEN test (`tests/test_analyze_hop.py::test_video_url_submission_with_no_quote_short_circuits_to_needs_quote`) can assert the LLM was never invoked at all for the short-circuit path, not merely that its output was discarded.
- Verified: `uv run pytest` (pipeline, 83 passed/1 pre-existing skip, run twice) and `uv run mypy app` (clean, 52 files) after the change.
- **Out of scope / not done here:** the API-layer rendering of `needs_quote` as a distinct submitter-facing status (vs. `ready`/`failed`) is a `services/api` concern (file-ownership boundary) — this wave only ships the pipeline's typed result; nothing here claims the status is surfaced end-to-end yet.

---
**See ADR-0031:** the binary-verdict + always-human-gate model here is refined to calibrated confidence-weighted guidance with risk-tiered auto-publish (the human gate shrinks as calibration proves out; named-person hard-negatives stay gated).

---
## Amendment (two-engine pivot, 2026-10-04) — human gate → async auditor; one pipeline, two front doors

**Status:** Accepted direction (owner-approved pivot 2026-10-04). Additive; the pipeline stages (1–8), the red-team amendments, and the citation/dedup/injection guards (shared with ADR-0023) are all retained unchanged.

- **Two ingestion front doors, one pipeline.** The **fetch engine** (ADR-0002/0032) and the **submission engine** both emit `submission.received.v1`; stages 1–8 are identical afterward. Events carry `ingest_source: "fetch" | "submission"` (ADR-0017 amendment). Fetched items carry `attribution: unverified` by default exactly as user-supplied quotes do (step 1 / amendment #6) — autonomy does not grant trust.
- **Step 7 (human review gate) is superseded as a *blocking* gate** by ADR-0031's amendment: for Tier A/B and Tier-C mode (a), a draft **auto-publishes** (caveated, claim-attributed) and a human **audits a shrinking sample asynchronously**; the editor is no longer the pre-publish approver for the majority of output. Tier-C mode (b) retains a pre-publish human tap (ADR-0031). The *technical* gates in step 6/7 (schema validation, citation integrity, framing enforcement, the `needs_quote` short-circuit) **still run before auto-publish** — only the *human approval* moves from blocking to async.
- **Step 1 (normalize) for the fetch engine** obeys the ADR-0002/0005 compliance boundary: no third-party audio download; STT runs only on the compliant subset (ADR-0005 amendment). A fetched third-party video with no lawful transcript text hits the SEC-4 `needs_quote`/no-LLM short-circuit — the fetch engine never fabricates a transcript.
- **Reverse-image/frame search (ADR-0032 §1b)** feeds the retrieve/verify stages for fetched items: an earlier-dated footage match is carried in as evidence for the dominant "recycled protest footage" tactic.

### Acceptance tests (additive)
| ID | Behaviour | Status |
|---|---|---|
| AT-0004-F | For Tier A/B and Tier-C mode (a), a draft auto-publishes after the technical gates (schema/citation/framing/`needs_quote`) pass, with no pre-publish human approval, and is recorded for async audit sampling; Tier-C mode (b) still blocks on a human tap. | RED |
