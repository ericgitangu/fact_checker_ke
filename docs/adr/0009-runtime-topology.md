# ADR-0009: Runtime topology, data stores and event flow

**Status:** Accepted (option a, 2026-10-03) · **Date:** 2026-10-03

## Problem
The brief wants Fastify, FastAPI, Rust and Go, EDA, serverless and multi-tenant, at near-zero cost, shipped this weekend. Every extra runtime adds a build pipeline, an image, a cold-start profile and a set of SDK quirks.

## Options
1. **Four-language polyglot from day one.** Rejected. That is four toolchains for a solo weekend, with no named gap that Rust or Go fill yet.
2. **Two runtimes.** TypeScript for the web/BFF and API, Python for the ML/media pipeline. Recommended.
3. **TypeScript only.** Viable, but the Python audio and ML ecosystem (ffmpeg wrappers, eval tooling, future XLS-R fine-tuning) is stronger.

## Decision (proposed): Option 2
- **apps/web:** Next.js (App Router) PWA. **apps/site:** the marketing SPA. Hosting: Cloud Run (GCP preference) or Vercel. ~~Decide on cost [GAP].~~ _(resolved — see ADR-0015: Vercel for apps/web and apps/site, Cloud Run for services/api and services/pipeline)_
- **services/api:** Fastify (TypeScript) on Cloud Run with min-instances=0. It handles submissions, the read API, auth and the ClaimReview output.
- **services/pipeline:** FastAPI (Python) on Cloud Run with min-instances=0. It runs normalize, STT, claim extraction, retrieval and draft verdict as separate idempotent endpoints.
- **Events:** QStash. Each stage publishes the next with a content-hash dedup key, retries and a DLQ. No Pub/Sub or Kafka (cost and ops) **[I]**. QStash free-tier limits are a **[GAP]**, so verify them before relying on it.
- **Postgres:** Neon with pgvector, holding claims, checks, sources, credibility registry, demonstrations and users. Scale-to-zero. Free-tier storage and compute-hour limits are a **[GAP]**.
- **Redis:** Upstash, for rate limits, the submission-velocity trend counters, and claim-hash lookups.
- **Blob:** GCS, for transient audio only, with a 24h lifecycle delete.
- **Secrets:** GCP Secret Manager, with Cloud Run `--set-secrets`.
- **Region:** Cloud Run `africa-south1`. Neon and Upstash `eu-central-1` (the closest available). Cross-region latency of about 150ms+ is acceptable for async pipelines **[I]**.
- **Multi-tenancy:** single product tenant now. Add `org_id` on content tables and RLS-ready schemas so that a partner newsroom or white-label tenant can be added later without a migration rewrite. Full multi-tenant isolation is deferred (YAGNI until there is a second tenant).
- **Rust and Go:** introduce one only against a named bottleneck, for example a Rust audio chunker if Python ffmpeg orchestration becomes the cost driver.

## Cost guardrails (non-negotiable)
- min-instances=0 everywhere.
- No NAT gateway, VPC connector or always-on DB.
- Budget alerts on GCP and Anthropic.
- Per-user daily quotas enforced in Redis.

## Trade-offs accepted
Cold starts of a few seconds on the first request. Cross-region DB latency. QStash vendor lock-in is mild because we have an HTTP-push model.

## Review trigger
Revisit if sustained throughput exceeds free tiers, or if a second tenant signs.

---
## Research round 2 (2026-10-03): amendments for grooming

| Service | Free tier | Evidence |
|---|---|---|
| QStash | **1,000 messages/day**. Retries count as messages. DLQ kept 3 days. Max delay 7 days | **[V2-PRIMARY]** |
| Upstash Redis | 500K commands/month, 256 MB | [V2-SECONDARY] |
| Neon | 100 CU-hours/month, 1 GB per project, 10 branches, scale-to-zero after 5 min | [V2-SECONDARY]. **pgvector on the free plan is unconfirmed: check in the console** |
| Cloud Run | 2M requests, 180K vCPU-s, 360K GiB-s/month. The 1 GiB egress free tier is reportedly North America only | [V2-SECONDARY] |
| Cloud Run `africa-south1` | **Reportedly a Tier 2 pricing region** (higher unit cost) | [V2-SECONDARY, non-vendor source] |

**Implications to groom:**
- **QStash is the first limit we'll hit.** Five pipeline stages per submission means roughly 200 submissions a day, fewer with retries. Options:
  - (a) Collapse stages into fewer hops: normalize+extract in one call, retrieve+draft in another.
  - (b) Use QStash only for the fan-out entry point, then chain stages in-process with idempotent checkpoints in Postgres.
  - (c) Move to GCP Pub/Sub or Cloud Tasks. Cloud Tasks' free tier is **[GAP]**.
  - Recommendation: (a) now. Revisit at about 150 submissions a day.
- **Region:** if Tier 2 is confirmed, weigh `africa-south1` (latency to Kenyan users, data-residency optics) against `europe-west` (Tier 1 and co-located with Neon and Upstash in eu-central-1). Most pipeline work is async, so EU co-location may win on both cost and DB latency **[I]**.

---
## Decision update (2026-10-03): ACCEPTED, two-hop pipeline

Option **(a)** was accepted by the product owner. The pipeline runs as **two QStash hops per submission**:
1. `analyze` = normalize + claim extraction
2. `verify` = retrieve + draft verdict

Each hop is idempotent on content hash, with the idempotency state in Redis. ~~(idempotency state in Redis)~~ _(superseded — see "Red-team amendments": idempotency per ADR-0017 §2, Postgres is the source of truth, Redis is a pre-check only)_ This keeps the QStash free tier (1,000 messages/day) at roughly 500 submissions a day before retries. ~~Revisit at about 300 submissions a day.~~ _(superseded — see "Red-team amendments": the 500/day estimate omits the sweeper, retries and failure callbacks)_

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #1, #2, #13 (blocker/high severity, persistence wave).

- **Amendment #1 [blocker]:** Idempotency state lives per ADR-0017 §2 — **Postgres is the source of truth**; Redis is a pre-check only (`SET NX` with TTL to shed obvious duplicates before opening a DB transaction). This corrects the stale "idempotency state in Redis" line above, which contradicts ADR-0017 and would mislead the persistence wave.
- **Amendment #2 [blocker]:** Add a QStash quota ledger: `daily messages = 2 × subs + retries + sweeps + callbacks`. The "~500 submissions/day" estimate above (and the "~300/day" review trigger) is wrong because it omits the ADR-0017 sweeper, failure callbacks and retries (red-team C-3). The sweeper runs at most hourly (not every 5 min — see ADR-0017 amendments). Alert at 70% of the 1,000 msg/day free-tier ceiling. Cloud Tasks is the resolved overflow path once its free tier is confirmed (previously `[GAP]`).
- **Amendment #13 [high]:** Add alerting on: DLQ non-empty, outbox oldest unpublished row older than 15 minutes, QStash/Neon/Upstash usage over 70% of free-tier quota, and elevated error rate (Sentry free tier or Cloud Error Reporting). Today only GCP/Anthropic billing budgets exist; nothing alerts on the DLQ (kept only 3 days) or outbox lag.

---
## Polyglot roadmap (U9) — owner decision, 2026-10-03

The "two runtimes" decision above is the **launch** posture, not the end state. U9 (portfolio headliner) is a first-class requirement: each language enters where it is the obviously-correct tool, never for CRUD. Slots, their ADR hooks, and entry triggers — all standalone, async, low-coupling services (another image + CVE surface + cold-start profile per runtime is the accepted cost for a solo operator, which is why none of these rewrite the core path):

| Slot | Language | ADR hook | Why this tool | Entry trigger |
|---|---|---|---|---|
| Trend-poller (RSS Nation/Standard/Citizen/KBC, Google Trends KE, submission-velocity aggregation) | **Go** | ADR-0002 "trending detection without scraping" | Hundreds of concurrent polite fetchers on goroutines; ~10MB static binary; scheduled Cloud Run Job; near-zero cold start | Phase 2 start (first natural Go addition, low blast radius) |
| Evidence archiver (snapshot + content-hash every cited source at publish time) | **Go** | ADR-0008 evidence-file requirement (defamation defence) | Concurrent fetch/hash/store; small, auditable, security-sensitive; explicit-error style | First named-person verdict workflow going live |
| SSE fan-out gateway | **Go** | ADR-0018 90s stream cap on Fastify | Cheap per-connection footprint once stream counts outgrow Node | Concurrent-stream growth past Fastify comfort (observed, not speculative) |
| C2PA provenance verifier | **Rust** | ADR-0006 provenance-first | `c2pa-rs` is the reference implementation (MIT/Apache-2.0, [V2]); any other language binds to Rust anyway — the most defensible Rust slot in the system | Provenance checks move server-side (Phase 2) |
| Audio chunker for live segmented ingest (30-60s windows) | **Rust** | ADR-0005 live mode; already named above as the example bottleneck | Real-time media slicing, predictable memory, no GC pauses, tiny image | Live-stream ingest lands AND Python chunking is the measured bottleneck |
| Embedding service (optional) | **Rust** | ADR-0004 dedup via pgvector | fastembed's core is Rust; ONNX embed service beats Python on cold start/RAM on Cloud Run | Embedding cold-start/RAM measurably hurts the two-hop latency budget |
| Expo native modules (share extension, widgets) | **Swift/Kotlin** | ADR-0010 | The native showcase; share-to-app is the core intake UX | Phase 1 store builds |

Enablers already in place: moon (ADR-0014) orchestrates arbitrary toolchains — Rust/Go tasks join the same graph, cache and `moon ci`; the deploy rail (ADR-0016) ships containers by digest, language-agnostic. **Rule retained:** a slot opens only when its trigger fires with an observed measurement or a live workflow need — never speculatively. Wave-4 interfaces (embedder, chunker) must stay Protocol-shaped so a Rust implementation can swap in without touching callers.

### Containerization benchmark: the `wave` project [V-OBSERVED 2026-10-03]
`~/Development/wave` is the house reference for two patterns the polyglot roadmap will reuse:
- **Rust-in-Python images:** `backend/Dockerfile.lambda` multi-stage builds a PyO3 Rust `.so` into a Python Lambda container (`linux/amd64`), with Rust `#[cfg(test)]` + pytest side by side — the packaging template for the Rust slots above (chunker, C2PA verifier) if they ship embedded rather than as standalone services; the PyO3 0.23 ↔ Python-version ABI pin is the known trap it documents.
- **Cost arc as precedent:** wave's always-on SageMaker endpoint (~$86/mo) → 59-min auto-stop scheduler → finally an in-process library at $0. Same trajectory the plan-guard (ADR-0016) enforces here from day one: the cheapest ML component is the one that runs inside a process you already pay for.
