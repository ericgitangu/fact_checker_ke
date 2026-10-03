# Architecture overview

This is the deep-dive companion to the [root README](../../README.md)'s N-tier diagram and sequence diagram. It exists so the README can stay under ~350 lines; the ADRs linked throughout are the actual source of truth — this page is a reading guide, not a new decision.

## Tier-by-tier detail

### Client tier
- **`apps/web`** — Next.js (App Router) PWA. The submit form, `/checks/[id]`, `/maandamano`. Installable, offline-aware shell.
- **`apps/site`** — Vite + React marketing SPA. Hero, methodology, GitHub CTA, waitlist stub.
- **`apps/mobile`** (planned, Phase 1) — Expo (EAS Build). Shares `packages/core` contracts with web; adds native modules for a "Share to fact_checker_ke" extension from TikTok/YouTube. See [ADR-0010](../adr/0010-client-strategy.md).

### Edge / BFF tier
- **Vercel** hosts `apps/web` and `apps/site`. The Next.js BFF route handlers do SSR/ISR of published checks and same-origin form posts, calling the Cloud Run API server-side.
- **Mobile deliberately bypasses the BFF** — it talks to the Cloud Run API directly through the typed client in `packages/core`, so SSE streams and native traffic never spend Vercel's Hobby-tier Active CPU budget on pure proxying. See [ADR-0015](../adr/0015-deployment-topology.md) for the full BFF trade-off writeup, including the commercial-use plan gate.

### API tier
- **`services/api`** — Fastify on Cloud Run, `min-instances=0`. Owns `/v1/submissions`, the read API, SSE (`/v1/submissions/:id/events`), and ClaimReview JSON-LD output. CORS allow-lists exactly the configured web/site origins.

### Async / EDA tier
- **Transactional outbox** — every state change and the event announcing it commit in one Postgres transaction. A relay publishes unpublished rows to QStash inline (before the HTTP response returns, so Cloud Run's request-based CPU model can't starve it) and a sweeper (at most hourly) catches anything the inline path missed.
- **QStash** — two hops per submission: `analyze` (normalize + claim detection) and `verify` (retrieve + draft verdict). Each hop is idempotent on content hash. QStash's 1,000 msgs/day free tier is the tightest binding constraint in the whole stack — see [ADR-0009](../adr/0009-runtime-topology.md) and the quota ledger in [ADR-0029](../adr/0029-cost-model-runway.md).
- **Upstash Redis** — pub/sub fan-out for SSE (`sub:{id}` channel), rate limits, and a fast idempotency pre-check (`SET NX`). Redis is never the source of truth for correctness-critical state. See [ADR-0017](../adr/0017-event-driven-core.md) and [ADR-0018](../adr/0018-realtime-and-caching.md).

### Intelligence tier
- **`services/pipeline`** — FastAPI on Cloud Run, `min-instances=0`, invoked only by QStash with a verified signature (public ingress, not network-private — corrected in [ADR-0015](../adr/0015-deployment-topology.md)'s red-team amendment).
- Stages: **normalize** (transcript/text segmentation, or a user-supplied quote+timestamp for third-party video) → **claim detection** (cheap model sorts statement into checkable claim / opinion / prediction / rhetoric) → **claim dedup** (pgvector embedding match, gated on similarity *and* matching negation/numbers/entities/dates) → **RAG retrieve** (own published checks, Google Fact Check Tools API, a curated Kenyan corpus) → **draft verdict** (strong Claude model, structured output, citations restricted to retrieved `doc_id`s). Model routing and cost controls: [ADR-0011](../adr/0011-ai-cost-controls.md). Full pipeline design: [ADR-0004](../adr/0004-verification-pipeline.md).

### Data tier
- **Neon Postgres + pgvector** — the source of truth: claims, checks, sources, the credibility registry, demonstrations, users, the outbox, the idempotency/inbox tables. Scale-to-zero after 5 minutes idle; nothing in the stack is allowed to ping it more often than that (healthz excluded, sweeper at most hourly) or it never actually suspends. See [ADR-0009](../adr/0009-runtime-topology.md) and the plan-guard in [ADR-0016](../adr/0016-deploy-rail-iac.md).
- **Upstash Redis** — ephemeral only: rate limits, pub/sub, pre-check locks.
- **GCS** — transient audio storage only, 24h lifecycle delete, for cases where the product is permitted to hold media (user uploads, owned/licensed content). No third-party video audio is ever downloaded ([ADR-0002](../adr/0002-content-ingestion.md)).

### Human tier
- **Editor review gate.** A draft never reaches a public page on its own. Named-person claims render `rating: null` to the submitter until an editor confirms the quoted text against the source (video embed timestamp, article text) and approves. Only then does `check.published.v1` fire, triggering ISR tag revalidation and ClaimReview JSON-LD. See [ADR-0004](../adr/0004-verification-pipeline.md) and [ADR-0008](../adr/0008-legal-compliance.md).

## Deploy rail

The atomic, reversible release path (build → `terraform plan` + plan-guard → expand-only migration → Cloud Run `--no-traffic` deploy + smoke → traffic shift → Vercel prebuilt deploy + smoke → promote) is specified in full, with its own mermaid flowchart, in [ADR-0016](../adr/0016-deploy-rail-iac.md). It is deliberately not duplicated here.

## Why two runtimes, not four

The brief asked about Fastify, FastAPI, Rust and Go. This repo runs exactly two: TypeScript (web/BFF/API) and Python (the ML/media pipeline, where the audio/eval tooling ecosystem is stronger). Rust or Go would be introduced only against a named bottleneck (for example, a Rust audio chunker if Python's ffmpeg orchestration becomes the cost driver) — not pre-emptively. See [ADR-0009](../adr/0009-runtime-topology.md).
