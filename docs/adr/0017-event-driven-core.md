# ADR-0017: Event-driven core — transactional outbox, idempotency, ACID boundaries

**Status:** Proposed · **Date:** 2026-10-03 · Builds on ADR-0009 (accepted two-hop pipeline)

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
| AT-0017-A | A quota-ledger test asserts that projected daily QStash messages = 2×subs + retries + sweeps + callbacks ≤ 800. | RED |
| AT-0017-B | The relay publishes to QStash before the 202 response is returned. The e2e test sees status `analyzing` within 5s with no sweeper running. | RED |
