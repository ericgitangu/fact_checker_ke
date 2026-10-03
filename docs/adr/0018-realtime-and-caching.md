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
| AT-0018-1 | Subscribing *after* completion immediately yields the terminal event, then the stream closes | RED |
| AT-0018-2 | Reconnecting with `Last-Event-ID` replays only the newer events, with no duplicates | RED |
| AT-0018-3 | The stream closes at 90s when nothing arrives, with heartbeats at 15s intervals | RED |
| AT-0018-4 | A third concurrent stream from one IP gets 429 | RED |
| AT-0018-5 | Draft and submission responses carry `no-store`. Published checks carry `s-maxage` and a strong ETag | RED |
| AT-0018-6 | `check.corrected` invalidates the ISR tag. The next request shows the corrected rating (e2e) | RED |
| AT-0018-7 | With Redis down, SSE still delivers the current state from Postgres and the client falls back to polling (degraded, not broken) | RED |
| AT-0018-8 | Stream/connection limits are keyed on device or session token, not bare IP. IP is only a coarse ceiling, at 50 or more. | RED |

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D (Section C C-9; high severity).

- **CGNAT false positives.** The existing guard "at most 2 concurrent streams per IP" (point 5 above) blocks many Safaricom users who share one egress IP under CGNAT. Limits are keyed on device or session token; IP remains only a coarse ceiling, raised to 50 or more. (See also ADR-0011 amendments, which apply the same device/session-keying principle to submission quotas.)
