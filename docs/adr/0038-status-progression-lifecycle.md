# ADR-0038: Status-progression lifecycle (drive every claim to a terminal state without a human editor)

**Date:** 2026-10-08 **Status:** accepted (additive, flag-gated, reversible)

**Amends:** ADR-0017 (adds an *editorial* lifecycle alongside the untouched
processing state-machine), ADR-0031 (the auto-publish/held outcome now
materialises into explicit public lifecycle states instead of an invisible
draft), ADR-0032 (virality becomes an escalation trigger, not only a feed sort),
ADR-0033 (AI-grounded preliminaries ride the existing caveat/right-of-reply
wrapper), ADR-0036 (the grounded rescue becomes a *thread-starter*, not only a
citation appender), ADR-0025 (the editor queue is redefined from "every draft"
to a bounded escalation queue).

## Problem

After verify, a check is either auto-published (low-stakes, non-named, calibrated
confidence in band) or left as an invisible `isDraft` row forever — so named-person
and no-source items never reach a terminal state and the feed lies that "a human
editor is still assessing it"; this ADR defines an autonomy-first lifecycle that
drives every claim to a terminal state with the (non-existent) human editor as the
exception, not the only promotion path.

## Why a new stored state is genuinely required (not reusing an existing enum)

`submissions.status` (ADR-0017: `received→analyzing→analyzed→verifying→ready|failed`)
is the **processing** machine — a conditional-`UPDATE` hop sequence — and must NOT
be overloaded with editorial meaning. The **editorial** state today is encoded in two
booleans (`checks.isDraft`, `checks.publishedAt`) that cannot distinguish the three
new states this design needs: an *AI-grounded preliminary* vs an *editor-held* item
(both `isDraft=true`), and an *expired/archived* item vs a *dismissed/failed* one.
`TrendingStatus` (`monitoring/under_review/published/dismissed`) is a *derived public
projection* (`deriveTrendingStatus`), not storage. Therefore one genuinely new,
**nullable, additive** column is required:

> **New:** `checks.lifecycle_state` — pgEnum `check_lifecycle`:
> `verifying | preliminary | awaiting_sources | editor_review | published | dismissed | archived_expired`.
> Nullable + backfilled by derivation from `(isDraft, publishedAt, submission.status)`,
> so every existing row is valid and the column can be dropped to fall back to
> today's boolean behaviour (reversible). `isDraft`/`publishedAt` remain the
> authoritative publish gate; `lifecycle_state` is the orthogonal editorial track.

## State machine

Terminal states: **`published`**, **`dismissed`**, **`archived_expired`**.
Every transition is labelled by its trigger:
**[A]**utonomous (pipeline verdict) · **[T]**ime (expiry sweep) · **[C]**ommunity
(crowdsourced sources) · **[E]**ditor (human promotion — the exception).

```
                         (ingest: submission or fetch)
                                     │ [A]
                                     ▼
                              ┌─────────────┐
                              │  verifying  │  (mirrors submission.status < ready)
                              └─────────────┘
             ┌─────────────[A]──────┼───────────────[A]────────────┐
             │ non-named &          │ draft produced but            │ no draft / no
             │ in-band &            │ auto-publish REFUSED          │ sources & rescue
             │ not frozen           │ (named OR below band)         │ returned nothing
             ▼                      ▼                               ▼
        ┌──────────┐         ┌──────────────┐              ┌──────────────────┐
        │ published│◄──[A]───│ preliminary  │              │ awaiting_sources │
        │(terminal)│  re-    │ (AI-grounded,│              │ (open thread,    │
        │          │  verify │  NOT a verdict)│◄──[C]──────►│  "submit truth") │
        └──────────┘  clears └──────────────┘  sources     └──────────────────┘
             ▲         band       │   ▲   │ attach             │        │
             │                [C/E]│   │  └────────[C]─────────┘        │
          [E]│ approve   escalate: │   │   N tier≤2 sources → re-verify │
             │ (named-   virality  │   │   (QStash → verify hop)        │
             │  person   / sources │   │                                │
             │  only)    / pull    ▼   │                                │
        ┌──────────────┐◄──────────┘   │                                │
        │ editor_review│───[E] reject──┼──────────────┐                 │
        │ (bounded     │               │              ▼                 │
        │  queue)      │               │        ┌──────────┐            │
        └──────────────┘               │        │ dismissed│◄──[A]──────┘
             │                         │        │(terminal)│  not checkable /
             │                    [T] no activity│        │  dedup / submission
             │                    > TTL          └──────────┘  failed
             └──────────[T]───────┐    │
          all non-terminal states │    │
          (longer TTL for         ▼    ▼
           editor_review)   ┌──────────────────┐
                            │ archived_expired │  (terminal; reopen only via a
                            │   (terminal)     │   fresh dedup-distinct source [C])
                            └──────────────────┘
```

Transition table (authoritative):

| From | To | Trigger | Rule |
|---|---|---|---|
| — | `verifying` | **[A]** | ingest (submission or fetch) accepted |
| `verifying` | `published` | **[A]** | non-named ∧ ADR-0031 calibrated-in-band ∧ kill-switches live (existing `enactPublishDecision` auto branch) |
| `verifying` | `preliminary` | **[A]** | draft produced but auto-publish refused (named-person **or** below band); rescue posts an AI-tagged thread-starter |
| `verifying` | `awaiting_sources` | **[A]** | no citable draft ∧ rescue returned no citations |
| `verifying` | `dismissed` | **[A]** | not a checkable claim / dedup to existing published check / submission `failed` |
| `preliminary`·`awaiting_sources` | `verifying` | **[C]** | ≥ `CROWDSOURCE_REVERIFY_THRESHOLD` accepted tier≤2 sources attach → re-enqueue verify hop with new evidence |
| `preliminary`·`awaiting_sources` | `published` | **[A]** | re-verify clears band **and item is non-named** |
| `preliminary`·`awaiting_sources` | `editor_review` | **[C]**/**[A]**/**[E]** | named-person re-verify clears **(never auto)**, or virality escalation (ADR-0032), or editor pull |
| `editor_review` | `published` | **[E]** | `POST /v1/editor/checks/:id/approve` (named-person gates in ADR-0004/0033 enforced) |
| `editor_review` | `dismissed` | **[E]** | reject |
| `preliminary`·`awaiting_sources` | `archived_expired` | **[T]** | `last_activity_at < now() − LIFECYCLE_EXPIRY_DAYS` (default 7) |
| `editor_review` | `archived_expired` | **[T]** | longer TTL `EDITOR_REVIEW_EXPIRY_DAYS` (default 30) — a human-owned item isn't yanked at 7d |

`last_activity_at` (new nullable timestamp on `checks`, defaults `created_at`) is
bumped by: ingest, preliminary post, each accepted community source, re-verify, any
editor touch. It is the single clock the expiry sweep reads.

**Hard legal invariant (ADR-0033/0004):** no `[A]` edge ever reaches `published`
for a named-person claim. The only named-person → `published` edge is `[E]`.

## Gemini-rescue-as-thread-starter

Today `verify.py` appends a `tier4_unverified` rescue doc only when `rescue()`
returns citations, then flows through `finalize_publish`; a named-person or
below-band item becomes an **invisible** draft. New behaviour — the rescue result
*materialises a public, non-authoritative thread*:

1. verify-hop runs as now; `finalize_publish` yields its `PublishDecision`.
2. If `autoPublish` → `published` (unchanged; non-named only — invariant above).
3. Else, if `rescue()` returned `assessment_text` + `cite_urls`:
   → create/keep the check with `lifecycle_state='preliminary'`,
   `source_kind='ai_grounded_preliminary'`, `authoritative=false`.
   - Public, but rendered as **"AI-grounded preliminary — not a verdict, not yet
     verified"** (ADR-0033 caveat wrapper). **Rating is withheld (NULL-to-public)
     for named persons**; non-named may show the model's stance behind the AI badge.
   - Emits `check.preliminary_posted`. Right-of-reply (ADR-0004) remains available.
4. Else (no citable rescue) → `lifecycle_state='awaiting_sources'`: a pure
   "no sources yet — help us find the truth" thread, no conclusion shown.

The preliminary/awaiting_sources states **invite progression** (crowdsource +
escalation) rather than terminating. This replaces the invisible-draft dead end.

## Crowdsourced source-seeking contract

**New table** `claim_source_submissions` (additive):
`{ id, check_id, url, note (≤2k), submitter_device_hash, status:
pending|accepted|rejected|duplicate, credibility_tier (derived), resolved_url,
created_at, reviewed_by, reviewed_at }`.

- **Endpoint:** `POST /v1/checks/:id/sources` — public (no auth), device-hash
  rate-limited (reuse submission throttle), URL-validated, deduped per check.
  Only valid against checks in `preliminary`/`awaiting_sources`/`editor_review`.
- **Weighing:** each URL is resolved server-side and tiered via the existing
  `tier_for_url` + `credibility_registry`. Tier ≤2 (authoritative) counts toward
  the re-verify threshold; tier4/unknown are kept as *community context only* and
  never auto-ingested as evidence (ADR-0023/0036 citation-integrity holds — a
  submitted URL is untrusted content, an agreement signal, not a verdict).
- **Re-verification trigger:** when accepted tier≤2 count ≥
  `CROWDSOURCE_REVERIFY_THRESHOLD` (default 2), **or** an editor marks one source
  authoritative → re-enqueue the claim through the verify hop (QStash → Cloud Run,
  **scale-to-zero, no always-on worker**) with the new sources injected as
  `RetrievedDoc`s. Outcome routes per the table: non-named may auto-publish;
  named-person routes to `editor_review` (never auto).
- **Abuse (ADR-0023/0024):** velocity caps per device-hash, coordinated-submission
  detection, and the citation-integrity gate are the defences; cost of re-verify is
  bounded by the shared ADR-0032/0036 cost breaker.

## Auto-expire policy

A daily **Cloud Scheduler → Cloud Run** sweep (scale-to-zero; **no always-on
infra**, per cost discipline) selects non-terminal checks whose `last_activity_at`
is older than the state's TTL and transitions them to `archived_expired` (terminal),
emitting `check.archived_expired`. Defaults: `LIFECYCLE_EXPIRY_DAYS=7`,
`EDITOR_REVIEW_EXPIRY_DAYS=30`, both env-tunable. The public thread then reads
"Archived — no verification emerged. Reopen by submitting a source" (a fresh
dedup-distinct authoritative source may reopen to `verifying`; otherwise terminal).
This is the pressure valve that stops the feed piling up.

## Editor-queue direction (correction to a naive queue)

**Naive approach to reject:** keep `getEditorQueue` = "every `isDraft` row". With
preliminary + awaiting_sources now materialised, that set is effectively the entire
backlog and would drown a solo founder — the opposite of autonomy-first.

**Direction:** the editor queue is **only** `lifecycle_state='editor_review'** — the
bounded set of items *escalated* by community source-weight, virality (ADR-0032), or
an explicit editor pull. Order by `(virality_score DESC, accepted_source_weight DESC,
last_activity_at DESC)`. Preliminary/awaiting_sources items live autonomously in
public and enter the queue *only* on an escalation edge. `approve` stays
`POST /v1/editor/checks/:id/approve` (now also sets `lifecycle_state='published'`
and bumps `last_activity_at`); `reject` → `dismissed`. Named-person approval still
requires the ADR-0004/0033 attribution + right-of-reply gates already in
`editorial.ts`. The in-flight minimal editor-queue agent must conform to this
bounded definition, **not** select all drafts.

## Home-page / feed information architecture

- **Pagination:** keyset (cursor) on `(virality_score DESC, created_at DESC, id)`;
  default page 20; never dump all rows. Backed by existing
  `checks_published_virality_idx` and `submissions_fetch_trending_idx`.
- **Two highlight rails at the top:** *Most viral* (order by `virality_score`) and
  *Most followed* (new lightweight `claim_follows` counter; falls back to virality
  until follows exist). The main mixed feed renders below.
- **Lifecycle made legible as a next-step affordance** (not a bare status chip) —
  each card shows the explicit next step toward terminal:
  - `published` → the verdict + rating (authoritative).
  - `preliminary` → "AI-grounded preliminary — not verified. **Help verify →**"
    (opens add-source).
  - `awaiting_sources` → "No sources yet. **Submit the truth →**".
  - `editor_review` → "Under editorial review" — shown **only** for items actually
    in `editor_review` (this is the fix for the current lie where every held draft
    claimed a human was assessing it).
  - `archived_expired` → "Archived — unverified. **Reopen with a source**".
- **Honest-copy correction:** `deriveTrendingStatus` must map from
  `lifecycle_state`, not from `isDraft` alone; `under_review` is emitted **only**
  when `lifecycle_state==='editor_review'`.

## Trade-offs accepted

1. **Public machine opinions.** AI-grounded preliminaries are visible and may be
   wrong — we trade editorial purity for a living feed, mitigated by hard
   non-authoritative labelling, no named-person rating, and right-of-reply. We
   accept the reputational risk of a clearly-labelled wrong preliminary.
2. **More state surface.** A new `lifecycle_state` enum + `last_activity_at` +
   `claim_source_submissions` table + sweep + crowdsource endpoint is materially
   more moving parts than two booleans — accepted because the booleans provably
   cannot express preliminary/awaiting/archived, and all of it is additive and
   flag-gated so it rolls back to today's behaviour.
3. **An abuse + cost surface.** Public source submission invites coordinated
   poisoning and each re-verify is a metered LLM call — we accept throttling +
   tier-gating + citation-integrity + a cost breaker over a closed system, knowing
   the re-verify lane is the first thing to strain at scale.

## Failure mode at 10x

The re-verification lane (QStash + Gemini/Claude metered calls) saturates its cost
breaker and the crowdsource endpoint becomes a spam/injection target before the DB
or feed does; the `editor_review` queue can still overflow one founder. First
thing that breaks: the re-verify cost breaker trips / queue backs up — by design it
fails closed (items stay in their current non-terminal state and expire on the TTL)
rather than dropping the legal invariants.

## Rollback path

Everything is additive and flag-gated: `FEATURE_PRELIMINARY_THREADS`,
`FEATURE_CROWDSOURCE_SOURCES`, `FEATURE_LIFECYCLE_EXPIRY`. Disable the flags → no
preliminaries posted, endpoint 404s, sweep no-ops; the system degrades to today's
held-draft behaviour. `lifecycle_state`/`last_activity_at` are nullable and the new
table is unreferenced when flags are off, so the migration can be dropped. Reversible
without data loss.

## Review trigger

Revisit when any of: `editor_review` depth trends > ~15/week (founder overwhelmed);
community preliminary→published conversion < 10% over 4 weeks (crowdsource not
working); any defamation complaint on a preliminary (re-tighten labelling/named gate);
auto-expire rate > 40% of non-terminal items (feed not converging — thresholds too
strict); or re-verify cost-breaker trips become routine (lane under-provisioned).

---

## Delegation notes (for sonnet + the in-flight full-stack / velocity agents)

Implement the lifecycle above. **Do not re-litigate** the state set, the named-person
auto-publish ban, the bounded editor queue, or the scale-to-zero sweep. Flag
implementation blockers without changing the approach. Align to these contracts;
flag-gate all of it.

### packages/db (schema + migration — additive only)
- Add pgEnum `check_lifecycle` (`verifying|preliminary|awaiting_sources|editor_review|published|dismissed|archived_expired`) and `checks.lifecycle_state` (nullable).
- Add `checks.last_activity_at timestamptz` (nullable, default `created_at`), `checks.source_kind text` (nullable; `'ai_grounded_preliminary'` etc.), `checks.authoritative boolean not null default true`.
- New table `claim_source_submissions` per the contract (FK `check_id`, device-hash, tier, status, resolved_url, review cols) + index on `(check_id, status)`.
- Optional `claim_follows` counter (or a column) for the "Most followed" rail — minimal, additive.
- New forward migration only (follow the `0024_*` numbering); backfill `lifecycle_state` from `(isDraft, publishedAt, submission.status)` using the `deriveTrendingStatus` precedence. **Additive/reversible — never drop or rewrite existing columns.**

### services/pipeline (verify + rescue as thread-starter + re-verify entry)
- In `app/stages/verify.py`: when `finalize_publish` does **not** auto-publish, branch on `rescue()` output — citations present → emit a `preliminary` outcome (carry `source_kind='ai_grounded_preliminary'`, `authoritative=false`, withhold rating for named-person); none → `awaiting_sources`. Keep fail-open to the no-source path.
- Keep the existing auto-publish path untouched (non-named, in-band). Preserve the named-person rating-withholding contract.
- Expose a re-verify entry (reuse the verify hop) that accepts injected crowdsourced `RetrievedDoc`s; route result per the transition table (named → `editor_review`, never auto). Meter via the shared ADR-0032/0036 breaker.

### services/api (enactment, lifecycle transitions, crowdsource endpoint, queue, sweep)
- Extend `lib/publish-enactment.ts`: on non-publish outcomes, set `lifecycle_state` (`preliminary`/`awaiting_sources`) + `last_activity_at` + emit `check.preliminary_posted`; on auto-publish set `published`. This is the single enactment point — keep it idempotent and fail-closed on missing summary.
- **Correct `getEditorQueue` (`lib/editorial.ts`): select only `lifecycle_state='editor_review'`**, ordered `(virality_score DESC, accepted_source_weight DESC, last_activity_at DESC)` — NOT all drafts. `approveCheck` also sets `lifecycle_state='published'`; `rejectCheck` → `dismissed`; both bump `last_activity_at`. Keep the `editor/admin` guard and named-person gates.
- New route `POST /v1/checks/:id/sources` (public, throttled, URL-validated, deduped) → insert `claim_source_submissions`, resolve + tier server-side (`tier_for_url`/`credibility_registry`), bump `last_activity_at`; when accepted tier≤2 count ≥ `CROWDSOURCE_REVERIFY_THRESHOLD`, enqueue re-verify via QStash.
- New authenticated sweep endpoint (e.g. `POST /internal/lifecycle/expire`) driven by Cloud Scheduler (scale-to-zero) that transitions stale non-terminal checks → `archived_expired` per `LIFECYCLE_EXPIRY_DAYS`/`EDITOR_REVIEW_EXPIRY_DAYS`, emitting `check.archived_expired`. **No always-on worker.**
- Fix `lib/trending-status.ts#deriveTrendingStatus` to read `lifecycle_state`; emit `under_review` only for `editor_review`. Add lifecycle + next-step fields to the feed read models.

### apps/web (feed IA + honest copy + affordances)
- Keyset pagination (cursor on `(virality_score, created_at, id)`), page 20; two top rails: Most viral, Most followed.
- Per-card next-step affordance keyed off `lifecycle_state` (published / preliminary "Help verify" / awaiting_sources "Submit the truth" / editor_review "Under editorial review" / archived_expired "Reopen with a source").
- Add-source UI → `POST /v1/checks/:id/sources`. **Remove the "a human editor is still assessing it" copy** anywhere it renders for non-`editor_review` items — it is false; replace with the real lifecycle affordance. Preliminary cards must render the ADR-0033 AI-grounded, non-authoritative caveat and never present a named-person rating.

### Config (all env-tunable, flag-gated)
`FEATURE_PRELIMINARY_THREADS`, `FEATURE_CROWDSOURCE_SOURCES`, `FEATURE_LIFECYCLE_EXPIRY`, `LIFECYCLE_EXPIRY_DAYS=7`, `EDITOR_REVIEW_EXPIRY_DAYS=30`, `CROWDSOURCE_REVERIFY_THRESHOLD=2`.
