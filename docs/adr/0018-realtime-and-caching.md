# ADR-0018: Near-real-time status (SSE) and caching

**Status:** Accepted (design set, owner, 2026-10-03) · **Date:** 2026-10-03 · Depends on ADR-0017 (events) and ADR-0015 (topology)

## Problem
A user who submits a claim should watch it move through `received → analyzing → verifying → ready` in near real time. Published checks should be served fast and cheaply to many readers. All of this has to run on scale-to-zero compute and free tiers.

## Evidence (verified 2026-10-03)
- Neon **pooled connections don't support LISTEN/NOTIFY**, and a long-lived direct connection with recurring traffic can block scale-to-zero **[V]**. **Postgres LISTEN is rejected** for fan-out.
- Upstash supports SUBSCRIBE/PUBLISH over **TCP** **[V]**. There's no official REST/SSE subscribe **[V]**. Whether pub/sub commands count against the 500K/month quota is undocumented, so **assume they do**.
- On Cloud Run, an open stream keeps CPU allocated and **billed for the whole open duration** **[V]**. Session length is the cost driver.

## Decision (proposed)

### SSE: `GET /v1/submissions/:id/events` (text/event-stream) on the Cloud Run API
1. **The source of events is the outbox.** When a status changes, ADR-0017 writes an outbox row. The relay *also* `PUBLISH`es a compact message `{event_id, status, at}` to the Redis channel `sub:{id}`. That is one command per transition, about 5 per check.
2. **The stream handler:**
   1. sends the **current state from Postgres first** (so a late subscriber never misses the terminal state)
   2. `SUBSCRIBE`s to `sub:{id}` over a TCP client
   3. forwards events with `id: <event_id>`
   4. sends comment heartbeats every 15s (no Redis traffic)
   5. **closes on a terminal state** (`ready` or `failed`) **or after 90s**, whichever comes first
3. **Resume:** the client reconnects with `Last-Event-ID`. The handler replays from Postgres (the outbox/event log for that submission) and then re-subscribes. No gaps, no duplicates (the client dedups on event id).
4. **Fallback:** after 2 failed reconnects, the client polls `GET /v1/submissions/:id` with `ETag`/`If-None-Match` every 3s with backoff. A 304 costs one indexed read and no body.
5. **Guards:**
   - at most 2 concurrent streams per IP and 1 per submission per client
   - streams only for submissions the caller created (a capability token in the 202 response, later auth)
   - a Cloud Run `--timeout` above the 90s cap

**Cost envelope [I]:** about 5 PUBLISH plus 1-2 SUBSCRIBE per check, roughly 10 commands. 500K/month covers about 50K checks before Redis is the constraint. The QStash quota (ADR-0009) binds first. CPU-time per check is capped at 90s of stream.

### Caching
| What | Where | Policy |
|---|---|---|
| Published check pages | Vercel CDN via Next.js ISR, tagged `check:{id}` | Revalidated **on demand** when the `check.published` / `check.corrected` event calls a signed BFF revalidate endpoint. No time-based staleness for corrections |
| Published check JSON (API) | HTTP: `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400` plus `ETag` | Published checks only. Drafts and submissions are `private, no-store` |
| Submission status (polling) | `ETag` derived from `(status, updated_at)` | 304 path |
| LLM, STT and embedding results | **Postgres** content-addressed result table (ADR-0017 §2) | Durable, deduplicating paid work. **Not Redis** (256 MB free cap, eviction) |
| Rate limits, idempotency pre-check, pub/sub | Upstash Redis | Ephemeral only. Nothing correctness-critical lives only in Redis |
| Fact Check Tools API responses | Postgres, TTL 24h, keyed by normalised query | Alpha API with no SLA **[V]**, so the cache also improves resilience |

**Correction safety:** a corrected verdict must never be served stale. Corrections publish `check.corrected.v1`, which triggers tag revalidation **and** a version bump in the ETag. The page shows its correction history (ADR-0008).

## Trade-offs accepted
- Redis pub/sub is at-most-once. That's acceptable because Postgres is replayed on connect and resume, so a missed live message only delays the update until reconnect or poll.
- A 90s cap means very slow checks finish via poll.

## Review trigger
Revisit if pub/sub metering turns out to be expensive (then switch to poll-only with long-poll), or if checks routinely exceed 90s.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0018-1 | Subscribing *after* completion immediately yields the terminal event, then the stream closes | GREEN |
| AT-0018-2 | Reconnecting with `Last-Event-ID` replays only the newer events, with no duplicates | GREEN |
| AT-0018-3 | The stream closes at 90s when nothing arrives, with heartbeats at 15s intervals | GREEN |
| AT-0018-4 | A third concurrent stream from one IP gets 429 | GREEN (keyed on device token per the red-team amendment below, not bare IP — see AT-0018-8) |
| AT-0018-5 | Draft and submission responses carry `no-store`. Published checks carry `s-maxage` and a strong ETag | GREEN |
| AT-0018-6 | `check.corrected` invalidates the ISR tag. The next request shows the corrected rating (e2e) | RED (apps/web's ISR tag-revalidation consumer — out of this wave's ownership; see implementation notes) |
| AT-0018-7 | With Redis down, SSE still delivers the current state from Postgres and the client falls back to polling (degraded, not broken) | GREEN |
| AT-0018-8 | Stream/connection limits are keyed on device or session token, not bare IP. IP is only a coarse ceiling, at 50 or more. | GREEN |

## Implementation notes (persistence/API wave, 2026-10-03)

**SSE (`services/api/src/routes/sse.ts`):** current state from Postgres first; `Last-Event-ID` resume replays `submission_events` via a correlated SQL subquery (`WHERE occurred_at > (SELECT occurred_at FROM submission_events WHERE event_id = $1)`), **not** a round-tripped JS `Date` — an earlier version compared against the anchor's own `occurredAt` pulled back out as a millisecond-precision `Date`, which (verified empirically against real Postgres, not just inferred) re-included the anchor event itself because Postgres's `timestamptz` stores microsecond precision the JS `Date` silently truncated. Heartbeats are SSE comment lines (`: heartbeat`) on a configurable interval (15s default, tunable per-instance via `sseHeartbeatMs`/`sseMaxDurationMs` so tests don't wait 90s for real). Closes on a terminal state or the duration cap, whichever comes first.

**Pub/sub (`services/api/src/lib/pubsub.ts`):** `IORedisPubSub` (ioredis, TCP) is the real implementation; `createPubSub` probes a live TCP connect with a 3s timeout and falls back to `InMemoryPubSub` (an in-process `EventEmitter`) on failure, logging the fallback loudly. **[UNVERIFIED-LIVE]:** `IORedisPubSub` has not been exercised against a live Upstash TCP endpoint from this sandbox (no network path to Upstash here) — it *was* exercised against a local `redis:7-alpine` container via `docker run` (not the repo's own `compose.yaml`, which another concurrent worktree's containers were already holding the default ports for), which speaks the same TCP SUBSCRIBE/PUBLISH protocol. Real Upstash TCP verification is deferred to the deploy-rail smoke.

**Concurrency guards (`services/api/src/lib/concurrency-guard.ts`):** `RedisConcurrencyGuard` (INCR+EXPIRE, Upstash REST) for the real path, `InMemoryConcurrencyGuard` for dev/test. Keyed on `X-Device-Token`, never bare IP — a coarse separate IP-keyed guard (limit 50) exists only as the red-team-amendment ceiling, not the primary control.

**Caching (`services/api/src/lib/cache-headers.ts`):** `GET /v1/submissions/:id` and `GET /v1/checks/:id` both compute an ETag and handle `If-None-Match` → 304, even though submissions are `no-store` — `no-store` forbids a *shared* cache from storing the body, not the client's own conditional-GET revalidation, so the fallback-polling path (point 4 in the Decision) still gets a cheap 304.

**Deviations / tech debt:**
- **AT-0018-6 (ISR tag revalidation) is explicitly out of scope and left RED.** It requires a signed BFF revalidate endpoint in `apps/web`, which this wave's file ownership excludes ("Do NOT touch apps/**"). The API-side half of correction safety (a version-bump-capable ETag) has a documented placeholder in `routes/checks.ts` — `publishedCheckEtag` currently derives its version from `publishedAt` because ADR-0008's correction workflow (the thing that would write a dedicated `corrected_at`/version column) doesn't exist yet either.
- The in-memory pub/sub fallback is single-instance only (no fan-out across multiple Cloud Run instances) — acceptable per the task brief's explicit fallback design, not silently papered over.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D (Section C C-9; high severity).

- **CGNAT false positives.** The existing guard "at most 2 concurrent streams per IP" (point 5 above) blocks many Safaricom users who share one egress IP under CGNAT. Limits are keyed on device or session token; IP remains only a coarse ceiling, raised to 50 or more. (See also ADR-0011 amendments, which apply the same device/session-keying principle to submission quotas.)
