# ADR-0032: Virality / trending-detection engine (the autonomous fetch engine)

**Status:** Proposed (two-engine pivot, owner-approved 2026-10-04) · **Date:** 2026-10-04
**Builds on:** ADR-0002 (ingestion, now two-engine), ADR-0009/0017/0018 (EDA core, scheduler, outbox), ADR-0005 (STT), ADR-0011 (cost controls), ADR-0023 (adversarial/cost-DoS), ADR-0031 (confidence-weighted auto-publish), ADR-0008/0033 (legal/caveat).
**Pairs with:** ADR-0002 Amendment (two-engine pivot) — that ADR owns *that* the fetch engine is a first-class source; this ADR owns *how* it decides what to check and the EDA topology that runs it.

## Problem
The product pivot (see ADR-0001 Amendment, 2026-10-04) makes fact_checker_ke a **self-sufficient, near-real-time** checker with two co-equal ingestion engines feeding one verification+publish pipeline. The **fetch engine** is the primary one ("bait the hook and catch"): it must autonomously decide *which* viral/trending political claims circulating on YouTube, X and TikTok are worth spending a verification pass on — with no user in the loop, on scale-to-zero compute, at cost-to-near-zero, in a polarized pre-election Kenya where false claims move at the speed of viral video and drive maandamano.

The hard questions this ADR answers:
1. **What signals** mark an item as "check-worthy" before we spend any LLM/STT budget on it?
2. **What EDA topology** runs the engine autonomously (scheduler → fetch → dedup → analyze) without an always-on worker?
3. **How we dedup** so a single viral clip submitted/observed 500× is paid for once.
4. **How we bound cost** (backpressure, caps, circuit-breaking) when the autonomous path has no human throttle and no Turnstile (ADR-0023) in front of it — the fetch engine is a *self-inflicted* cost-DoS surface the submission engine's admission controls do not cover.

## Context and non-negotiable boundary (carried from ADR-0002)
The fetch engine runs on **official platform APIs first**, via the **owner's own developer accounts**, with a **fakes/fixtures fallback** so the whole engine runs offline until keys are supplied ("activate on owner's keys"). Two realities must be encoded honestly, not papered over:

- **Owner keys do not cure ToS.** Official-API access and the owner's dev accounts grant *discovery and metadata*, not the right to download or isolate third-party audio/video. ADR-0002 round-2 **blocker #8** (YouTube policy bars downloading/caching A-V content and bars isolating the audio) and **blocker #5** (`captions.download` works only on videos you can edit) still stand. TikTok is treated the same until confirmed otherwise. **The fetch engine therefore never downloads or transcribes third-party YouTube/TikTok audio.** STT (ADR-0005) runs only on the *compliant subset* (see §"Transcript sourcing").
- **Autonomy raises the stakes, not just the throughput.** An autonomously-published assessment about a named politician is a defamation vector (ADR-0008) with no human in the submit loop. The fetch engine's output is governed by ADR-0031's risk tiers and ADR-0033's standing caveat exactly as the submission engine's is — virality is a *selection* signal, never a *publishing* authorization.

## Per-platform feasibility (KE-landscape research, 2026-10-04) — what is actually buildable
The engine is **not** uniformly feasible across platforms. These structural facts drive the Decision below, not an appendix:

| Source | Official-API feasibility for a KE commercial pilot | Cost | Role in this ADR |
|---|---|---|---|
| **YouTube Data API v3** | **Feasible and cheapest/most ToS-compliant.** Quota 10,000 units/day; `search.list` = 100 units → ~100 searches/day inside the free quota; `videos.list` = 1 unit **[from ADR-0002 round-2 V2-SECONDARY]**. | Free within quota | **PRIMARY fetch source.** |
| **PesaCheck / Africa Check** | **Feasible now, no gating.** Publish open data via openAFRICA / CKAN (reusable) and debunk viral KE claims fastest; poll via **RSS/CKAN** (no dedicated realtime API confirmed — **[GAP: verify]**). | Free | **First-class triage feed AND check-against source** (see §1, §"Check-against sources"). |
| **X / Twitter API v2** | Usable but **metered pay-per-use** since the free tier was discontinued (Feb 2026); ~$0.005/read, ~2M reads/month cap; legacy Basic/Pro closed to new devs **[landscape research 2026-10-04; matches ADR-0002/0003 round-2]**. | **Real money** — conflicts with cost-to-near-zero | Secondary, **budgeted and sampled, never a firehose** (see §4). |
| **TikTok Research API** | **Almost certainly NOT available** to a Kenya-based *commercial* fact-checker — gated to academic / public-interest institutions in US/EEA/UK/Switzerland **[ADR-0002 V, reconfirmed 2026-10-04]**. | n/a | **Explicit compliance decision point, not an assumed capability** (see below). |

**TikTok is a decision, not a default.** Ingesting TikTok requires one of: (a) a public-interest/academic *partnership* that qualifies for the Research API; (b) the narrow public **oEmbed** path for a specific submitted/observed URL (embed + metadata only, no discovery, no audio); or (c) accepting ToS/ban risk via unofficial means — **(c) is rejected** on the same grounds as scraping (ADR-0002 irreversible: account bans). Until (a) exists, TikTok is **embed-plus-metadata only**, driven by cross-platform spread detected elsewhere (a TikTok clip mirrored to X/YouTube), never by autonomous TikTok discovery.

## Options
1. **Crawl/scrape for trending content.** Rejected — same grounds as ADR-0002 option 1: ToS violations, IP/account bans, and it contradicts the "authoritative and compliant" positioning. A ban kills the channel.
2. **YouTube-primary cron-polled allow-list + PesaCheck/Africa Check triage feed, X sampled-and-budgeted, TikTok embed-only; score each item on a virality function, dedup, then feed the existing pipeline.** Recommended. Uses only official APIs + open data + metadata the owner's accounts can lawfully read; scale-to-zero; cost-bounded by cadence, caps and a per-read X budget.
3. **Pay a third-party social-listening/trends vendor** (Brandwatch/Meltwater-class). Deferred — recurring cost fights the near-zero target; revisit if a grant funds it.

## Decision: Option 2

### 1. What to check — the virality / check-worthiness score
Each observed item gets a composite `checkWorthiness` score; only items above a per-source threshold `τ_fetch` enter the pipeline. The score is a weighted function of:

- **Engagement velocity** — rate of change of views/likes/reposts/comments *per unit time*, not absolute count. A clip going 0→50k in 2h outranks a 1M-view clip from last month. (Absolute counts favour incumbents; velocity catches the *emerging* false claim, which is the point.)
- **Cross-platform spread** — the same claim/clip observed on ≥2 of {YouTube, X, TikTok} scores higher. Cross-posting is the strongest "this is going viral" signal and is also a dedup key (§3).
- **Claim density** — a cheap pre-filter pass (Haiku-class, ADR-0011) over available text (title, description, caption-if-lawfully-available, cross-posted text) estimates whether the item contains *checkable factual claims* vs. pure opinion/entertainment. Low claim density → skip before any expensive hop. This reuses ADR-0004 step 2's claim/opinion classifier as a gate, not a full analysis.
- **Recency** — exponential decay; a claim's check-worthiness halves on a configurable half-life so stale virality doesn't crowd out fresh claims.
- **Political/public-safety salience** — a keyword/entity match against a curated KE political-entity + maandamano-term list raises priority (and routes to the ADR-0008 public-safety handling). This list is **data, not code** (same pattern as ADR-0021's `retention_policy` and ADR-0004's credibility registry) and is owner/editor-editable.

`τ_fetch`, the weights, and the half-life are **configuration, not constants in code**, and start deliberately conservative (few items, high bar) — loosening is the ADR-0031 "quality ramp", gated by cost and calibration evidence, not a code change.

**Source priority (from the feasibility table):** YouTube Data API v3 is the primary discovery source; **PesaCheck/Africa Check RSS/CKAN is a first-class triage feed** — a claim they have already debunked is both the highest-priority "this is going viral in KE" signal *and* an authoritative check-against hit (ADR-0004 step 4), often letting us attribute/reuse rather than re-verify from scratch; X is polled **sampled and budgeted** (not a firehose); TikTok is embed-only unless a partnership lands.

### 1b. Narrative types to expect, and reverse-image-search as a first-class check
KE-landscape research names the recurring viral-disinformation tactics the engine must be built for, not surprised by:
- **Recycled / misattributed OLD protest footage re-captioned as a new event** — the single most common tactic. **Reverse-image / reverse-video-frame search is therefore a named, first-class capability** in the fetch→verify path: before (or alongside) claim verification, key frames/thumbnails are reverse-searched to find earlier appearances of the same footage. An earlier-dated match is itself the verdict ("this video is from <date/place>, not the claimed event"). This is the highest-value check for the dominant tactic and is not optional.
- **Ethnic-framing of protests** — routes to the ADR-0008 public-safety / ADR-0024 trust-&-safety handling; high salience, Tier C by default (ADR-0031).
- **Conflicting operational claims** (transport running or not, a protest on or off, roads open or closed) — time-sensitive, short-lived; recency weight and `valid_as_of` (ADR-0004/0023) matter most here.
- **Deepfakes / synthetic media** — triaged per ADR-0006 (C2PA + detector-as-triage, never "deepfake" on a score alone), not adjudicated by the fetch engine.

### Check-against sources (authoritative, for the verify hop — extends ADR-0004 step 4)
Beyond our own published checks and the Fact Check Tools API, the fetch/verify path grounds KE political claims against: **Parliament Hansard** (searchable), **Judiciary causelist / e-filing portals** (for case-status claims), **KNBS** (statistics), and the **PesaCheck/Africa Check** open corpus (openAFRICA/CKAN). **Verify-before-building:** public/stable **IEBC and KNBS APIs are unconfirmed [GAP]** — treat them as "confirm the access path exists before depending on it", not as assumed endpoints. These are additive to ADR-0004's curated corpus, surfaced here because the fetch engine's KE-political focus leans on them heavily.

### 2. EDA topology (no always-on worker)
The fetch engine is event-driven on the ADR-0009/0017 core, triggered by a **QStash schedule** (cron), never a resident poller:

```
QStash cron (per-source cadence)
  → POST /internal/fetch/poll?source=<id>        [fetch hop, services/pipeline or a thin TS fetcher]
      → pull candidate items via official API (or FakeSource in dev)
      → score checkWorthiness (§1); drop below τ_fetch
      → emit fetch.candidate.v1 to the transactional outbox (ADR-0017)   [one row per surviving candidate]
  → dedup hop (ADR-0004 step 3 + §3 below): cross-platform + content-hash + claim-embedding
      → novel claim → submission.received.v1 (same event the submission engine emits) → existing analyze/verify/assess pipeline
      → known claim → attach observation to the existing check, bump its trend counters, NO new spend
  → verify/assess hop → ADR-0031 publish-policy (tiered, caveated, auto-publish default)
```

Key properties:
- **One pipeline, two front doors.** After `submission.received.v1`, a fetched item and a user-submitted item are indistinguishable to analyze/verify/assess. The fetch engine adds a *source* front door, it does not fork the pipeline (ADR-0002 Amendment).
- **Provenance is carried.** Every event gains `ingest_source: "fetch" | "submission"` and, for fetch, `{platform, source_id, observed_at, engagement_snapshot}` so published assessments can be attributed ("detected trending on …") and so cost/quality can be measured per engine.
- **No new cron infra.** The fetch schedule is QStash (ADR-0009), reusing the same quota ledger (ADR-0017 AT-0017-A) — fetch polls are counted into the daily-message budget alongside subs/retries/sweeps/callbacks, so the ledger math must be re-sized (see §4 and the amended AT-0017-A note).

### 3. Dedup (the primary cost lever)
Three layers, each cheaper than the next hop it protects:
- **Platform-item identity** — `(platform, native_id)` already seen in the last N days → drop immediately (no scoring).
- **Cross-platform claim identity** — the same clip reposted (e.g. a TikTok mirrored to X) is matched by content fingerprint (title/description/duration/thumbnail-hash where available) *before* embedding, collapsing cross-posts into one candidate while still recording the spread signal.
- **Claim-embedding dedup** — reuses ADR-0004 step 3 + ADR-0023 §3 guards (similarity ≥ τ **and** matching negation/number/entity/date + `valid_as_of`). A hit reuses the existing check (ADR-0017 layer-3 content-addressed cache), so a viral claim observed 500× is verified and paid **once**; subsequent observations only increment trend counters (Upstash, ADR-0009/0018).

### 4. Backpressure and cost controls (cost-to-near-zero, scale-to-zero)
The autonomous path has no human and no Turnstile in front of it, so its cost ceiling must be *structural*:
- **Per-source, per-run candidate cap** — each poll emits at most `maxCandidates` surviving items; excess (lowest score) is dropped, not queued, so a viral storm can't fan out unbounded spend.
- **Per-engine daily spend breaker** — the fetch engine has its own budget line in the ADR-0011 global breaker, independent of the submission engine's. At 80% it stops emitting *new* candidates (dedup/trend-counter updates continue); at 100% it hard-stops fetch polling until the next window. The submission engine is never starved by a fetch overspend, and vice-versa.
- **Cadence is the coarse throttle** — conservative per-source cron intervals (e.g. hourly for high-signal sources, daily for the long tail) keep QStash messages and YouTube quota (100 units/`search.list`, ~100 searches/day free) well under free-tier limits. Intervals are config.
- **X reads are metered — sample, don't firehose.** X API v2 is pay-per-use (~$0.005/read, ~2M/mo cap); X polling carries its own hard per-read monthly budget inside the fetch breaker, samples rather than streams the full hashtag firehose, and degrades to "YouTube + PesaCheck/Africa Check only" when the X budget is exhausted — never an unbounded read spend. This is a named cost trade-off below.
- **Scale-to-zero preserved** — no resident poller, no min-instances>0, no NAT gateway (global cost policy). The fetcher is a Cloud Run endpoint woken by QStash, idle otherwise.
- **Kill-switch** — the fetch engine honours a global `FETCH_ENGINE_ENABLED` flag and the ADR-0031/0007 kill-switch: flipping it off stops autonomous ingestion and autonomous publishing within one propagation cycle, leaving the submission engine and read paths live.

### Transcript sourcing (compliance boundary, ties to ADR-0005)
The fetch engine's claim-extraction input, in priority order, is:
1. **Platform-provided text** the owner's API access can lawfully read: title, description, cross-posted text (X/Threads), and captions **only where the API legitimately returns them** (not `captions.download` on third-party videos — that is blocked).
2. **Owner-authorized / partner / open-licensed audio** (ADR-0005 round-2 scope): live-capture of permitted streams, partner-broadcaster content via OAuth, our own uploads, and openly-licensed official audio (Bunge). **This is the only subset STT runs on.**
3. **Otherwise: embed + claim-from-available-text, or route to the owner-authorized path.** For a third-party viral video with no lawful transcript path, the engine checks the claim extractable from metadata/cross-posted text and shows the embed for context — it does **not** fabricate a transcript or download audio (ADR-0004 SEC-4 `needs_quote` short-circuit applies: no text ⇒ no LLM call).

This is a real coverage limit: some viral *video* claims cannot be transcribed and will be checked only from their surrounding text or not at all until a licensed path exists. Named as a trade-off below, not hidden.

## Reference landscape appendix (to be populated — companion deep-research)
> **PLACEHOLDER — populate from the concurrent KE-landscape deep-research.**
> The *structural* feasibility facts from the companion research (per-platform API gating, costs, narrative types, check-against sources) are **already folded into the Options/Decision/trade-offs above** — they changed what is buildable and do not belong in an appendix. What remains for this appendix is the **named-source specifics**: the exact Kenyan YouTube channels, X/Twitter handles, TikTok accounts, news RSS feeds, political-entity and maandamano-term salience lists, and known-disinformation sources to seed the allow-list. **That named list is not yet merged.** When it lands, append it here as "Appendix A: KE source allow-list and salience terms (research `<run-id>`, dated)" with each entry tagged by the ADR README evidence legend ([V]/[U]/[I]/[GAP]). Until then, the engine runs on `FakeSource` fixtures (dev) and a minimal owner-seeded list; **no production allow-list is asserted by this ADR.**

### Appendix A — KE source seed list & salience terms (research 2026-10-04)
Populated from `docs/research/ke-misinformation-landscape-2026.md` (full citations there). Evidence legend: **[V]** verified ·2+ · **[U]** single/unconfirmed · **[GAP]** verify before building. This is a **seed for the discovery allow-list, not an endorsement** — "known-to-produce-speculation" is a reason to *monitor*, not a verdict on any creator.

- **YouTube — monitor (political commentary/speculation):** Herman Manyora [V], Alex Chamwada [V], Cyprian Nyakundi/"Declassified" [V — history of unverified/defamatory claims], Lynn Ngugi [V], "The Kenya We Want" [V]; Citizen TV (broadcast baseline) [V]. **→ primary ingestion (YouTube Data API v3).**
- **X — sampled/budgeted:** hashtag cluster #RutoMustGo / #RejectFinanceBill / #OccupyParliament / #OccupyStateHouse [V, bursty]; individual handles **[GAP] — do not hardcode without re-verifying live.**
- **TikTok — embed-plus-metadata only (no autonomous discovery):** campaign tag #TheLordOfViolence [V].
- **Triage feeds (poll as near-realtime debunk source AND check-against):** PesaCheck (openAFRICA/CKAN open data; RSS) [V], Africa Check [V], Code for Africa [V].
- **Authoritative check-against:** Parliament Hansard (hansardna/hansardsn .parliament.go.ke, searchable) [V], Judiciary (efiling.court.go.ke + causelist) [V], KNBS [V — API GAP], IEBC [V — API GAP].
- **Narrative-type priors (feed the claim-density/salience scorer):** recycled/misattributed old protest footage (dominant → **reverse-image-search is the top check**) [V], ethnic framing [V], conflicting operational (transport/protest on-off) claims [V], deepfakes [V].
- **Salience seed terms:** Ruto, maandamano, Finance Bill, IEBC, Gen-Z, Occupy*, RejectFinanceBill, protest turnout, police/deaths.

Entries tagged **[GAP]** must be verified against the live source before they enter a production allow-list; **[V]** named creators are monitoring seeds only. Re-tune `τ_fetch`/weights from observed precision (ADR-0031 flywheel). Do not treat this list as exhaustive or static.

## Trade-offs accepted
1. **Coverage is bounded by the ToS compliance boundary.** Third-party viral *video* audio is off-limits; some high-virality clips will be checkable only from metadata/cross-posted text, or not at all, until a licensed/partner path exists. We accept weaker video coverage in exchange for not risking the account bans that would kill the channel entirely (ADR-0002 irreversible).
2. **Selection is heuristic and will mis-prioritize.** A velocity/claim-density score will sometimes chase a non-claim viral moment or miss a slow-burn falsehood. Mitigated by the conservative starting `τ_fetch` and the ADR-0031 flywheel (observed precision tunes the weights), not solved.
3. **Autonomous spend is a new, self-inflicted cost surface.** Without the per-engine breaker and caps, a viral storm or a bad `τ_fetch` could run up LLM/STT cost with no human throttle. We accept carrying a second budget breaker and the complexity of per-engine accounting as the price of autonomy.
4. **X monitoring now costs real money.** The free tier is gone; sustained hashtag monitoring is metered (~$0.005/read). We accept X as a *sampled, budgeted* secondary source — not the near-realtime firehose the brief imagined — so the cost-to-near-zero target holds. YouTube (free quota) + PesaCheck/Africa Check (free open data) carry the primary load.
5. **TikTok discovery is effectively unavailable.** No autonomous TikTok trending detection without a public-interest/academic partnership we do not have; TikTok enters only as embed-plus-metadata when a clip surfaces via another platform. Accepted rather than take the ban risk of unofficial access.

## Irreversible / hard to undo
- **An autonomously-published assessment is public the moment it ships** — there is no human in the fetch submit loop to catch it first. This is why fetch output is bound to ADR-0031 Tier handling (Tier C defaults to claim-attributed open-question framing) and ADR-0033's standing caveat, and why the kill-switch is non-negotiable. A false auto-published defamatory statement cannot be recalled from the internet or screenshots (ADR-0008/0031).
- **Account bans** (ADR-0002) — running discovery from accounts/IPs tied to production, or crossing the audio-download line, risks a ban that removes the platform as a channel permanently. The compliance boundary above is a hard line, not a preference.

## Review triggers
- The KE-landscape research lands → populate Appendix A, re-tune `τ_fetch`/weights/salience from real sources.
- Fetch-engine daily spend approaches its budget line for N consecutive days → review caps/cadence before raising the budget.
- Any defamation complaint traced to an auto-published fetched item → immediate review of fetch→Tier-C routing with ADR-0008/0031.
- A platform offers a sanctioned fact-checker/trends programme (e.g. X Community Notes API, a TikTok research path) → revisit the compliance boundary and option 3.
- Fetch-vs-submission precision diverges materially (flywheel data) → re-weight or gate the weaker engine.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0032-1 | With no platform API keys configured, the fetch engine runs end-to-end on `FakeSource` fixtures (poll → score → dedup → `submission.received.v1`) and makes zero outbound platform-API or billable LLM/STT calls (verified via request logs, not inferred). | RED |
| AT-0032-2 | An item below `τ_fetch` (low velocity AND low claim-density) is dropped before any embedding or LLM call; a config change to `τ_fetch`/weights changes the selection with no code change. | RED |
| AT-0032-3 | The same claim observed on two platforms, and the same claim observed 500×, each produce exactly one verification pass (one paid analyze+verify); subsequent observations only increment trend counters and attach observations, emitting no new `submission.received.v1`. | RED |
| AT-0032-4 | No fetch-engine code path downloads or isolates third-party YouTube/TikTok audio; STT is invoked only on the compliant subset (owner-authorized/partner/open-licensed/live-capture). A fetched third-party video with no lawful transcript text hits the `needs_quote`/no-LLM short-circuit (ADR-0004 SEC-4), never a fabricated transcript. | RED |
| AT-0032-5 | The fetch engine has its own daily-spend breaker: at 80% it stops emitting new candidates while dedup/trend updates continue; at 100% it hard-stops polling; the submission engine's budget and operation are unaffected by a fetch overspend (and vice-versa). | RED |
| AT-0032-6 | `FETCH_ENGINE_ENABLED=false` stops autonomous ingestion and autonomous publishing within one propagation cycle while leaving the submission engine and all read paths live (kill-switch); every published fetched assessment carries `ingest_source: "fetch"` provenance and routes through the ADR-0031 tiered publish-policy identically to a submitted one. | RED |
| AT-0032-7 | YouTube Data API v3 is the primary discovery source and no path exceeds its daily quota; X polling is sampled and hard-capped by a per-read monthly budget, degrading to "YouTube + PesaCheck/Africa Check only" when exhausted; no autonomous TikTok *discovery* path exists (TikTok enters only as embed-plus-metadata via cross-platform spread). | RED |
| AT-0032-8 | A fetched item whose footage reverse-image/frame search matches an earlier-dated appearance is flagged "recycled/misattributed footage" and that earlier match is carried into the verify hop as evidence (the dominant KE tactic is a first-class check, not an afterthought). | RED |

---

## Addendum (2026-10-05): the public "Trending / under review" stream

**Problem the refinement closes.** The fetch engine works — it discovers viral
Kenyan videos and runs them through the pipeline — but most discoveries do NOT
become PUBLISHED checks: a fresh/breaking viral has no pre-existing fact-check
evidence to cite, so ADR-0031's publish policy correctly HOLDS it as a draft
for the editor (the existing editor queue, "decision C", is left untouched).
The result was that the engine's core value proposition — "we catch what's
trending, immediately" — was **invisible** to readers, because the only public
surface (`GET /v1/feed`) shows PUBLISHED checks only. A held viral discovery
appeared nowhere.

**Decision (owner decision A+C).** Add a public read-model that surfaces the
fetch **discoveries themselves** — the viral video + its engagement + a
**derived tracking status** — regardless of publish status, WITHOUT touching
the editor queue or the publish/evidence guards.

- **Persistence.** The fetch outbox writer
  (`services/pipeline/app/stores/outbox_postgres.py`) now persists the
  discovery metadata as COLUMNS on the `submissions` row (migration `0020`,
  EXPAND-only): `source_url` (the discovered VIDEO link), `platform`,
  `engagement` (jsonb `{views,likes,comments}`), `virality_score`
  (`numeric(12,4)`, same log-weighted formula as `checks.virality_score`).
  These are deliberately **not** written to `submissions.url` — that column is
  half of the `submissions_url_or_text` XOR constraint and the fetch path is a
  `text`-only submission; the video link is provenance of what we're tracking,
  a distinct concept, so it gets its own column and the constraint is
  untouched. A partial index `submissions_fetch_trending_idx`
  (`virality_score DESC NULLS LAST, created_at DESC` where
  `ingest_source = 'fetch'`) serves the read.
- **API.** `GET /v1/trending` returns fetch-sourced discoveries ordered by
  virality DESC NULLS LAST, each with a status DERIVED (not stored) from the
  submission status + its own check (`services/api/src/lib/trending-status.ts`):
  `monitoring` (in-flight, or `ready` with no own check), `under_review`
  (a HELD DRAFT check exists — a human editor is assessing it), `published`
  (a published check exists → links its `checkId`), `dismissed` (submission
  `failed`). Read-only, cache-friendly, no kill-switch (like `/v1/feed`, it is
  a read surface, not an ingestion/publish one).
- **Web.** A self-hiding "Trending now — what we're tracking" section leads the
  `/feed` page (above "Most viral", which is published-only), with a tracking-
  status chip per item and an honest note: **a status is not a verdict, and
  "under review" means an editor is assessing it.**

**Non-negotiable kept (decision C).** The stream exposes ONLY the discovered
video's own metadata plus the derived status — it NEVER exposes a held draft's
rating/summary/verdict, and a draft's `checkId` is never surfaced (only a
PUBLISHED check is linkable). The editor queue and the ADR-0031 publish/
evidence guards are unchanged. Virality remains a *selection/surfacing* signal,
never a *publishing* authorization.

**Trade-off accepted.** A fetch discovery that reaches `ready` with no check of
its own (deduped to an already-published claim owned by a different submission,
or no checkable claim) is shown as `monitoring` rather than inventing a
`published` status from another submission's check — honest, but it means a
small set of "resolved-elsewhere" discoveries read as still-tracked. Documented
in `deriveTrendingStatus` rather than papered over.

**See ADR-0002** (fetch engine as a first-class PRIMARY source), **ADR-0031** (tiered, caveated auto-publish is the default operating mode), **ADR-0033** (standing caveat + indemnity on every published assessment), **ADR-0017** (new `fetch.*` events + re-sized QStash quota ledger), **ADR-0005** (STT compliance subset), **ADR-0011** (per-engine cost breaker).
