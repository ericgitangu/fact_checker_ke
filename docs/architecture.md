# Architecture

`fact_checker_ke` is a Kenyan fact-checking and maandamano (protest) tracking
system. It ingests public claims from two independent paths — an autonomous
source-polling engine and user submissions — runs them through one shared
analysis-and-verification pipeline, and publishes results under a risk-tiered
editorial lifecycle that never auto-publishes a claim about a named person.

The core is event-driven: every stage hands off through a transactional outbox
drained by QStash, so a crash between stages loses nothing and a replay produces
the same result. Services run on GCP Cloud Run in `africa-south1`, scale to zero
when idle, and persist to Neon serverless Postgres. The web client is a Next.js
PWA on Vercel.

Design decisions behind this document are recorded in `docs/adr/`.

## Components

| Component | Stack | Role |
|---|---|---|
| `apps/web` | Next.js PWA (Vercel) | Public feed, submission UI, live status via SSE |
| `services/api` | Fastify / TypeScript (Cloud Run) | BFF; submission intake, outbox writer, SSE, read APIs |
| `services/pipeline` | FastAPI / Python / uv (Cloud Run) | Fetch, analyze, verify, publish-policy hops |
| `packages/core` | Zod | Shared event and domain schemas, contract validation |
| `packages/db` | Drizzle ORM / Neon | Schema, migrations, typed queries |
| `packages/i18n` | — | English / Swahili message catalogs |

External dependencies: YouTube Data API (region-KE trending triage), Google Fact
Check Tools (prior-work retrieval), Vertex AI Gemini with Google Search grounding
(independent corroboration and grounded rescue), Anthropic Haiku and Sonnet
(claim scoring, extraction, draft writing), Upstash Redis (state, SSE fan-out,
idempotency), and QStash (cron and queue transport).

## System context

```mermaid
flowchart TB
  subgraph Vercel["Vercel"]
    WEB["apps/web (Next.js PWA)"]
  end

  subgraph CloudRun["GCP Cloud Run (africa-south1, scale-to-zero)"]
    API["services/api (Fastify BFF)"]
    PIPE["services/pipeline (FastAPI)"]
  end

  subgraph Data["Managed data"]
    PG["Neon Postgres (Drizzle)"]
    REDIS["Upstash Redis (state / SSE / idempotency)"]
  end

  subgraph Transport["Transport"]
    QSTASH["QStash (cron + queues)"]
  end

  subgraph External["External APIs"]
    YT["YouTube Data API"]
    FCT["Google Fact Check Tools"]
    GEM["Vertex AI Gemini (Search grounding)"]
    ANT["Anthropic (Haiku / Sonnet)"]
  end

  WEB -->|"POST /v1/submissions"| API
  WEB -->|"SSE status stream"| API
  API -->|"outbox + reads"| PG
  API -->|"SSE fan-out / idempotency"| REDIS
  API -->|"enqueue"| QSTASH

  QSTASH -->|"cron: fetch tick"| PIPE
  QSTASH -->|"drain: hop events"| PIPE
  PIPE -->|"read / write"| PG
  PIPE -->|"state"| REDIS

  PIPE -->|"trending triage"| YT
  PIPE -->|"prior fact-checks"| FCT
  PIPE -->|"grounded corroboration"| GEM
  PIPE -->|"score / extract / draft"| ANT
```

The two Cloud Run services split by language and concern: the API is the only
writer on the submission path and the only SSE origin; the pipeline owns all hop
processing. They never call each other directly — QStash is the sole coupling,
which keeps the pipeline insensitive to API restarts (and the reverse) and lets
each scale to zero independently.

Trade-offs. Scale-to-zero means a cold first request after idle; acceptable for a
low-QPS public tool and the reason the submission path is async (the client gets
an id immediately and watches SSE, rather than blocking on a cold pipeline).
Neon and Upstash sit in `eu-central-1` (closest region to `africa-south1`), so
cross-region latency is paid on every DB and Redis round trip — tolerable here
because the hot public-feed reads are cache-friendly and hop processing is not
latency-bound.

## Two-engine data flow

```mermaid
flowchart TB
  subgraph E1["Engine 1: autonomous fetch"]
    CRON["QStash cron tick"] --> FETCH["fetch hop"]
    FETCH --> SRC["YouTube mostPopular (KE / News)\nPesaCheck + Google News RSS"]
    SRC --> SCORE["score virality + claim density (Haiku)"]
    SCORE --> DEDUP["dedup"]
    DEDUP --> SURV["survivors"]
  end

  subgraph E2["Engine 2: user submission"]
    USER["web PWA"] --> POST["API POST /v1/submissions"]
    POST --> OUTBOX["transactional outbox"]
  end

  SURV -->|"submission.received"| CONV(("converge"))
  OUTBOX -->|"submission.received"| CONV

  CONV --> ANALYZE["analyze hop\nlanguage ID / translate / claim extraction (Haiku)"]
  ANALYZE --> VERIFY["verify hop\nretrieval + grounded corroboration / rescue + draft (Sonnet)"]
  VERIFY --> POLICY["publish-policy (risk-tiered)"]
  POLICY --> LIFE["editorial lifecycle"]
  LIFE --> FEED["public feed"]
```

Both engines emit the same `submission.received` event, so everything downstream
of convergence is written and tested once. The difference between an
autonomously-fetched item and a user submission is erased at the convergence
point — provenance is carried as event metadata, not as a separate code path.

Engine 1 spends money (Haiku scoring, API quota) on every candidate, so the cheap
filters run first: virality and claim-density scoring, then dedup, gate what
reaches the shared pipeline. Dedup is also what stops a trending clip and a user
submission of the same clip from becoming two threads.

Failure notes. The fetch hop is idempotent per source-item id, so a cron retry or
overlapping tick re-scores but does not re-emit. The outbox write and the API
response share one transaction: if the client gets `202`, the event is durably
enqueued; if the transaction fails, the client gets an error and nothing leaks
into the pipeline.

## Verify hop

```mermaid
sequenceDiagram
  autonumber
  participant Q as QStash
  participant V as VerifyHop
  participant FCT as FactCheckTools
  participant G as VertexGemini
  participant S as Sonnet
  participant DB as Postgres

  Q->>V: deliver analyze.completed (claims)
  V->>FCT: retrieve prior fact-checks
  FCT-->>V: matches or none

  alt authoritative prior work found
    V->>G: corroborate against grounded search
    G-->>V: grounded evidence + citations
  else no prior work
    V->>G: grounded rescue (independent search)
    G-->>V: grounded assessment + citations
  end

  V->>V: citation-integrity checks
  V->>S: draft verdict from evidence
  S-->>V: draft + calibrated confidence
  V->>DB: persist draft + evidence
  V->>Q: emit verify.completed (to publish-policy)
```

Retrieval runs before any model writes a verdict: if Google Fact Check Tools
already has authoritative prior work, Gemini corroborates against it rather than
re-deriving the answer. When there is no prior work, the grounded-rescue branch
has Gemini search independently so a novel claim still gets an evidence-backed
assessment instead of being dropped.

The citation-integrity check sits between evidence gathering and drafting: every
claim the draft will rest on must trace to a retrieved source. This is the guard
against a fluent but unsupported verdict — a draft whose citations do not hold up
cannot reach publish-policy as a verdict. A grounded assessment that produced no
authoritative source is still kept, but it is routed as a labelled, non-verdict
"preliminary" (see the lifecycle below), not as a decision.

Sonnet writes the draft and a calibrated confidence; that confidence is an input
to publish-policy weighting, not a publish decision on its own.

## Editorial status lifecycle

```mermaid
stateDiagram-v2
  direction TB

  state "verifying" as verifying
  state "published" as published
  state "preliminary" as preliminary
  state "awaiting sources" as awaiting_sources
  state "dismissed" as dismissed
  state "editor review" as editor_review
  state "archived (expired)" as archived_expired

  [*] --> verifying

  verifying --> published: autonomous / low-stakes non-named
  verifying --> preliminary: autonomous / grounded but no authoritative source
  verifying --> awaiting_sources: autonomous / insufficient evidence
  verifying --> editor_review: autonomous / named-person or escalated
  verifying --> dismissed: autonomous / not checkable

  preliminary --> verifying: community / sources submitted
  awaiting_sources --> verifying: community / sources submitted

  editor_review --> published: editor / approve
  editor_review --> dismissed: editor / reject

  preliminary --> archived_expired: time / stale
  awaiting_sources --> archived_expired: time / stale

  published --> [*]
  dismissed --> [*]
  archived_expired --> [*]
```

Triggers are labelled by actor: **autonomous** (the pipeline's own
publish-policy), **community** (crowdsourced source submissions),
**editor** (a human in the review queue), **time** (the staleness sweep).

The invariant the state machine enforces: a claim about a named person never
reaches `published` from `verifying` directly — it must pass through
`editor_review`. Low-stakes, non-named items can auto-publish. An item the
pipeline can ground but for which no authoritative source exists becomes a
`preliminary` — public, but explicitly labelled as a non-authoritative
assessment, not a verdict.

`preliminary` and `awaiting_sources` are the open, improvable states: a
crowdsourced source submission moves them back to `verifying` for
re-verification. This is the loop that lets the system improve a result after
first publication without a human in the path, while still capping unbounded open
items — the staleness sweep expires anything that sits open too long to
`archived_expired`. Terminal states are `published`, `dismissed`, and
`archived_expired`; nothing leaves them.

## Deployment topology

```mermaid
flowchart TB
  subgraph Client["Client"]
    PWA["Browser / installed PWA"]
  end

  subgraph Edge["Vercel"]
    WEBAPP["apps/web (Next.js)"]
  end

  subgraph GCP["GCP africa-south1"]
    subgraph Run["Cloud Run (scale-to-zero)"]
      APISVC["services/api"]
      PIPESVC["services/pipeline"]
    end
  end

  subgraph Managed["Managed services (eu-central-1)"]
    NEON["Neon Postgres"]
    UPSTASH["Upstash Redis"]
  end

  subgraph Sched["Transport"]
    QS["QStash (cron + queues)"]
  end

  PWA -->|"HTTPS"| WEBAPP
  WEBAPP -->|"read / submit"| APISVC
  WEBAPP -.->|"SSE"| APISVC

  APISVC -->|"SQL"| NEON
  APISVC -->|"state / idempotency"| UPSTASH
  APISVC -->|"publish events"| QS

  QS -->|"cron: fetch"| PIPESVC
  QS -->|"queue: hops"| PIPESVC
  PIPESVC -->|"SQL"| NEON
  PIPESVC -->|"state"| UPSTASH

  QS -. "signed delivery + retries" .-> PIPESVC
```

Cron and queue delivery are the same transport: QStash fires the fetch tick on a
schedule and drains hop events from the outbox, delivering both to the pipeline
over signed HTTP with retries. There is no always-on worker — the pipeline exists
only while QStash is delivering, which is what makes scale-to-zero viable for the
processing path.

Idempotency keys are carried on both the API intake and the pipeline consumers,
so QStash's at-least-once delivery (and its retries) cannot double-process a hop.
Redis holds the SSE fan-out state and the idempotency ledger; a Redis outage
degrades live status updates and idempotency dedup but does not corrupt the
durable record, which lives in Postgres.

Connection strings are held in GCP Secret Manager and injected into Cloud Run at
deploy; they are never baked into images.
