# fact_checker_ke

A Kenyan fact-checking PWA: submit a URL or text, get a transcript, extracted claims,
retrieval-augmented draft verdict — always reviewed by a human before publication —
plus a read-only maandamano (protest) advisories page.

## Repo map

```
apps/web          Next.js (App Router) PWA — submit form, /checks/[id], /maandamano
apps/site          Marketing SPA (Vite + React) — hero, how it works, waitlist stub
packages/core      zod schemas, inferred types, ClaimReview builder, typed API client
services/api       Fastify API — submissions, checks, health
services/pipeline  FastAPI (Python/uv) — normalize/transcribe/extract/retrieve/draft stage stubs
db/migrations      Plain SQL migrations for Neon Postgres + pgvector
compose.yaml       Local dev only: postgres (pgvector) + redis
docs/adr           Architecture decision records — see docs/adr/README.md
```

## Local dev

```bash
# Node toolchain (apps/web, apps/site, packages/core, services/api)
pnpm install
pnpm turbo run lint typecheck test build

# Python pipeline
cd services/pipeline
uv sync
uv run pytest

# Local Postgres + Redis (optional, for API persistence work)
docker compose up -d

# Run a single service
pnpm --filter @fact-checker-ke/api dev
cd services/pipeline && uv run uvicorn app.main:app --reload
pnpm --filter web dev
pnpm --filter site dev
```

Copy each `.env.example` to `.env` and fill in local values before running a service
that needs them — see `.env.example`, `apps/web/.env.example`.

## Architecture decisions

See [docs/adr/README.md](docs/adr/README.md) for the runtime topology, client strategy,
and the rationale behind the two-runtime (TypeScript + Python) split.
