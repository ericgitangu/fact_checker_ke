# ADR-0009: Runtime topology, data stores and event flow

**Status:** Accepted (option a, 2026-10-03) · **Date:** 2026-10-03

## Problem
The brief wants Fastify, FastAPI, Rust and Go, EDA, serverless and multi-tenant, at near-zero cost, shipped this weekend. Every extra runtime adds a build pipeline, an image, a cold-start profile and a set of SDK quirks.

## Options
1. **Four-language polyglot from day one.** Rejected. That is four toolchains for a solo weekend, with no named gap that Rust or Go fill yet.
2. **Two runtimes.** TypeScript for the web/BFF and API, Python for the ML/media pipeline. Recommended.
3. **TypeScript only.** Viable, but the Python audio and ML ecosystem (ffmpeg wrappers, eval tooling, future XLS-R fine-tuning) is stronger.

## Decision (proposed): Option 2
- **apps/web:** Next.js (App Router) PWA. **apps/site:** the marketing SPA. Hosting: Cloud Run (GCP preference) or Vercel. Decide on cost **[GAP]**.
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

Each hop is idempotent on content hash, with the idempotency state in Redis. This keeps the QStash free tier (1,000 messages/day) at roughly 500 submissions a day before retries. Revisit at about 300 submissions a day.
