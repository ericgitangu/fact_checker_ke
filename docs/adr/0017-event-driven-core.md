# ADR-0017: Event-driven core — transactional outbox, idempotency, ACID boundaries

**Status:** Accepted (pattern set, owner, 2026-10-03) · **Date:** 2026-10-03 · Builds on ADR-0009 (accepted two-hop pipeline)

## Problem
A submission must reliably become a published check through two async hops (`analyze`, `verify`) on scale-to-zero compute, with at-least-once delivery (QStash). Failure modes to design out:
- **Dual write:** the DB commits but publishing fails (lost work), or the publish succeeds but the DB rolls back (ghost work).
- **Duplicate delivery:** retries and redeliveries double-charge LLM tokens or double-write results.
- **Duplicate client requests:** double-taps and mobile retries create duplicate submissions.
- **Out-of-order or concurrent hops** for the same submission.

## Decision (proposed)

### 1. Transactional outbox (ACID at the producer)
Every state change and the event announcing it are written in **one Postgres transaction**:
```
BEGIN;
  INSERT INTO submissions (...)            -- or UPDATE status
  INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, created_at, published_at NULL, attempts 0)
COMMIT;
```
A **relay** publishes unpublished outbox rows to QStash and marks them `published_at`. The relay selects with `FOR UPDATE SKIP LOCKED LIMIT n` so concurrent relays never double-publish the same row.
- The relay runs **inline after commit** (best effort, low latency).
- It is also a **sweeper** on a schedule: the QStash schedule hits `POST /internal/outbox/drain`, which catches anything the inline path missed. No always-on worker (cost policy). ~~(schedule interval unspecified here)~~ _(superseded — see "Red-team amendments": the sweeper runs at most hourly, both for the QStash quota ledger (ADR-0009) and to avoid keeping Neon awake, see ADR-0016 amendments)_
- The outbox row id becomes the QStash **deduplication id**, so a relay crash between publish and mark cannot fan out twice.

### 2. Idempotency, three layers
| Layer | Mechanism | Key |
|---|---|---|
| Client → API | `Idempotency-Key` header (UUIDv4, required on `POST /v1/submissions`). A table `idempotency_keys(key, request_hash, response_status, response_body, created_at)` is written in the **same transaction** as the submission. A replay with the same key and body returns the stored response. The same key with a different body returns 422. TTL 24h | client key |
| Broker → consumer | QStash signature verification, then an **inbox** table `processed_messages(message_id PK, handler, processed_at)` inserted in the **same transaction** as the handler's writes. A duplicate fails the PK insert, so the handler acks without re-running | QStash message id |
| Expensive side effects (LLM, STT) | Content-addressed result cache: `hash(stage, model, prompt_version, input)` → stored result. Re-running a hop after a crash reuses the paid result | content hash |

Redis is used only as a **fast pre-check** (`SET NX` with TTL) to shed obvious duplicates before opening a DB transaction. **Postgres is the source of truth for idempotency**, so a Redis eviction or outage can't cause double processing.

### 3. Ordering and concurrency
- The hops are a strict state machine on `submissions.status`: `received → analyzing → analyzed → verifying → ready | failed`.
- Each handler advances state with a **conditional update** (`UPDATE … SET status='verifying' WHERE id=$1 AND status='analyzed'`). Zero rows updated means stale or duplicate, so the handler acks and stops. That gives optimistic concurrency without locks held across LLM calls.
- **Never hold a DB transaction open across an external call** (LLM, Fact Check API). The pattern is: read, then call outside a transaction, then commit result + outbox + inbox atomically.

### 4. Failure handling
- QStash retries with backoff. After the retry budget runs out, the failure-callback path marks the submission `failed` with a reason and writes an outbox event (`check.failed`), so the user sees a terminal state, never a spinner forever.
- A poison message (one that fails validation) is acked and recorded, not retried. Retries are reserved for transient errors (typed error values distinguish the two).
- Retries count against the QStash daily quota **[ADR-0009 V2-PRIMARY]**, so transient-vs-permanent classification is also a cost control.

### 5. Events (versioned, with the payload schema in `packages/core`)
`submission.received.v1`, `submission.analyzed.v1`, `check.drafted.v1`, `check.failed.v1`, `check.published.v1` (after human approval, ADR-0004). Each payload carries `{event_id, occurred_at, submission_id, org_id, schema_version}`. Python models are generated through the ADR-0009/codegen path.

## Trade-offs accepted
- Outbox, inbox and idempotency tables add writes per request. That's negligible at this scale, and Neon storage is cheap.
- At-least-once delivery plus idempotent consumers is preferred over attempting exactly-once (not achievable across HTTP boundaries).
- Inline relay plus sweeper means up to one sweep interval of extra latency when the inline publish fails.

## Facts pending verification
These affect implementation, not the pattern:
- the QStash dedup header semantics and window
- the signature verification API
- whether failure callbacks are available on the free tier

## Review trigger
Revisit if more than about 300 submissions a day hits the QStash quota (ADR-0009), or if a second consumer type appears (then consider Pub/Sub).

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #2, #3 (blocker severity, persistence wave).

- **Amendment #2 [blocker]:** The sweeper interval is at most hourly, not every 5 minutes. A 5-minute sweeper both overstates the QStash daily-message budget (ADR-0009's ledger: `2×subs + retries + sweeps + callbacks`) and risks keeping Neon awake past its 5-minute idle-suspend window (red-team C-3, C-4; see ADR-0016 amendments for the Neon wake budget).
- **Amendment #3 [blocker]:** The inline relay publishes to QStash **before** the HTTP response is returned to the caller, never fire-and-forget after the response. Under Cloud Run's request-based CPU model (`cpu_idle=true`, enforced by the ADR-0016 plan-guard), work scheduled after the response is sent can be starved, which would make every event wait for the sweeper and make SSE (ADR-0018) look dead (red-team C-5).

## Acceptance tests

| ID | Behaviour | Status |
|---|---|---|
| AT-0017-A | A quota-ledger test asserts that projected daily QStash messages = 2×subs + retries + sweeps + callbacks ≤ 800. | GREEN |
| AT-0017-B | The relay publishes to QStash before the 202 response is returned. The e2e test sees status `analyzing` within 5s with no sweeper running. | GREEN |

## Implementation notes (persistence/API wave, 2026-10-03)

**Schema (`packages/db` + `db/migrations/0003`, `0004`):** `outbox`, `processed_messages`, `idempotency_keys`, `submission_events`, `device_tokens` (ADR-0020 slice). `submissions.status` extended to `received|analyzing|analyzed|verifying|ready|failed` — the old catch-all `processing` value is migrated to `analyzing` for any pre-existing row (`0003`'s `UPDATE ... WHERE status = 'processing'` before the enum swap). `submissions.updated_at` added (`0004`) as the ETag source for ADR-0018 polling. All four migrations were applied and verified against a real `pgvector/pgvector:pg17` container (not just `drizzle-kit generate`'s dry run).

**Events (`packages/core/src/schemas/events.ts`):** zod schemas for all five ADR-0017 §5 event types, exported via `index.ts`, regenerated through `pnpm gen:contracts` with a clean drift gate. `org_id` deliberately uses a non-strict "8-4-4-4-12 hex" check rather than zod's RFC-4122-strict `.uuid()` — the latter rejects `packages/db`'s own `ORG_DEFAULT` seed constant (`...000000000001`, version nibble `0`), which Postgres's `uuid` column type itself doesn't enforce.

**Idempotency (three layers, `services/api/src/lib/idempotency.ts`, `outbox.ts`, `advance.ts`):** layer 1 (client→API) is a Postgres-authoritative `idempotency_keys` row inserted in the same transaction as the submission, with a Redis `SET NX` pre-check that is advisory only (`NoopIdempotencyPreCheck` when Upstash env is unset). A race between two concurrent identical-key requests is resolved by `IdempotencyRaceLostError`: the loser's whole transaction (including its own submission insert) rolls back, and it replays the winner's committed response instead of leaving an orphaned duplicate submission. Layer 2 (broker→consumer) is the `processed_messages` inbox, checked inside `advanceWithInbox` before the conditional state-machine update. Layer 3 (expensive side effects / content-addressed result cache) is **not implemented** in this wave — it belongs to `services/pipeline` (explicitly out of scope: "Do NOT touch services/pipeline").

**Outbox relay:** `publishOutboxRowInline` runs inside the SAME request (before the 202 response returns — red-team Amendment #3), with its own `SELECT ... FOR UPDATE` on just that row. `drainOutbox` is the sweeper's `SELECT ... FOR UPDATE SKIP LOCKED LIMIT n` over every unpublished row, sharing the same publish-then-mark logic. Both were verified against real Postgres (`submission-outbox.integration.test.ts`), including `select count(*) from outbox where published_at is null` reaching 0 after a drain.

**Publisher:** `QStashPublisher` wraps `@upstash/qstash`'s `Client` unmodified; `FakePublisher` is the dedup-id-aware in-memory double used by every test in this wave, since **QStash cannot deliver a signed callback to a localhost sandbox** — real end-to-end QStash delivery is unverified here and lands with the deploy-rail smoke (ADR-0016), not this change.

**Internal endpoints:** `POST /internal/outbox/drain` and `POST /internal/events/submission-advanced` are protected by `SignatureVerifier` (real: `QStashSignatureVerifier` wrapping `@upstash/qstash`'s `Receiver`; fails closed to `DenyAllSignatureVerifier` when no signing keys are configured). Tests exercise the ROUTE's authorization behaviour against an injected fake verifier rather than reproducing QStash's JWT signing format — see `lib/internal-auth.ts`'s docblock. The dev-only simulator (`POST /internal/dev/simulate`, registered only when `!isProduction`) drives a submission through all four hops via the exact same `advanceWithInbox` code path the signed route uses, with two of the four hops carrying real, schema-validated synthetic events (`submission.analyzed.v1`, `check.published.v1`) so the SSE id-bearing-replay path has something real to exercise.

**Deviations / tech debt:**
- Layer-3 idempotency (content-hash result cache) is pipeline territory, not implemented here — flagged, not silently dropped.
- `check.published.v1`'s `check_id` in the dev simulator is a synthetic UUID with no backing `checks` row (checks pipeline is out of scope for this wave); fine for exercising the event/SSE machinery, not a real check.
- The relay (`drainOutbox`/`publishOutboxRowInline`) deliberately holds a Postgres transaction across the QStash HTTP publish call — the one place in this codebase that does so. This is intentional (SKIP LOCKED needs the lock held to prevent double-publish, and the call is a fast single HTTP POST, not an LLM/Fact-Check-API call), but is called out explicitly because ADR-0017 §3's "never hold a transaction open across an external call" rule is otherwise a hard line.
- `drizzle-orm`'s postgres-js `.execute()` resolves to the row array directly (`RowList`), not a node-postgres-style `{rows: [...]}` wrapper, and `DELETE`'s affected-row count is `.count`, not `.rowCount`. An initial implementation assumed the node-postgres shape, which typechecked (cast via `as unknown as`) but would have thrown "not iterable" at runtime; caught empirically against a real Postgres before merge, not by the type checker. Left as a documented landmine for the next person reaching for `.execute()`.

---
## Amendment (two-engine pivot, 2026-10-04) — fetch-engine events and a re-sized QStash quota ledger

**Status:** Accepted direction (owner-approved pivot 2026-10-04). Additive; the outbox/inbox/idempotency pattern, the three idempotency layers, the state machine and the red-team amendments (hourly sweeper, publish-before-response) are all retained unchanged.

- **New events (versioned, in `packages/core`):** `fetch.poll.scheduled.v1` (QStash cron fires a poll), `fetch.candidate.v1` (a scored, above-`τ_fetch` item survives, ADR-0032 §1), and `fetch.observation.v1` (a dedup-hit observation that only bumps trend counters, no new verification). A surviving novel candidate converts to the existing `submission.received.v1` so the rest of the state machine is unchanged. Every event payload gains `ingest_source: "fetch" | "submission"` and, for fetch, `{platform, source_id, observed_at, engagement_snapshot}`.
- **The QStash quota ledger (AT-0017-A) must be re-sized.** The projection `2×subs + retries + sweeps + callbacks ≤ 800/day` now adds **fetch polls**: `+ Σ(per-source poll cadence)`. Conservative cron intervals (ADR-0032 §4: hourly for high-signal sources, daily for the long tail) keep the total under the free-tier budget, but the ledger test must include the fetch-poll term explicitly rather than silently overrunning. **This supersedes AT-0017-A's formula.**
- **Scale-to-zero preserved:** the fetch poller is a QStash-woken Cloud Run endpoint, no resident worker, no min-instances>0 (global cost policy) — the same posture as the outbox sweeper.

### Acceptance tests (additive)
| ID | Behaviour | Status |
|---|---|---|
| AT-0017-C | The quota-ledger test includes a fetch-poll term (`2×subs + retries + sweeps + callbacks + fetch_polls ≤ budget`) and fails if fetch cadence config would breach the free-tier daily message budget; fetch events carry `ingest_source` provenance and dedup-hit observations emit no new `submission.received.v1`. | RED |
