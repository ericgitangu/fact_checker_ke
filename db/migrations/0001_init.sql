-- fact_checker_ke: initial schema for Neon Postgres.
-- Plain SQL, no ORM forced (see docs/adr/0009-runtime-topology.md).
-- Every content table carries org_id for future multi-tenancy (ADR-0009:
-- single tenant today, RLS-ready schema so a second tenant needs no
-- migration rewrite). RLS policies themselves are deferred (YAGNI until
-- there is a second tenant) -- tracked as tech debt below.

-- Note: the pgvector *package* is commonly called "pgvector", but the
-- Postgres extension it registers is named "vector".
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- Single tenant row exists today; org_id columns below default to it so
-- existing rows don't need backfilling when a second tenant is added.
create table if not exists organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'fact_checker_ke')
on conflict (id) do nothing;

create table if not exists submissions (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    url text,
    text text,
    submitted_by text,
    status text not null default 'received'
        check (status in ('received', 'processing', 'ready', 'failed')),
    created_at timestamptz not null default now(),
    constraint submissions_url_or_text check (
        (url is not null and text is null) or (url is null and text is not null)
    )
);

create index if not exists submissions_org_id_idx on submissions (org_id);

create table if not exists credibility_registry (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    domain text not null unique,
    credibility_tier text not null
        check (credibility_tier in ('tier1_primary', 'tier2_established_media', 'tier3_general', 'tier4_unverified')),
    notes text,
    updated_at timestamptz not null default now()
);

create table if not exists sources (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    url text not null,
    title text not null,
    publisher text not null,
    credibility_tier text not null
        check (credibility_tier in ('tier1_primary', 'tier2_established_media', 'tier3_general', 'tier4_unverified')),
    published_at timestamptz,
    retrieved_at timestamptz not null default now(),
    excerpt text
);

create index if not exists sources_org_id_idx on sources (org_id);

create table if not exists checks (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    submission_id uuid not null references submissions (id) on delete cascade,
    summary text not null,
    rating text
        check (rating in ('True', 'MostlyTrue', 'Misleading', 'False', 'Unproven', 'NotCheckable')),
    is_draft boolean not null default true,
    reviewed_by text,
    created_at timestamptz not null default now(),
    published_at timestamptz,
    constraint checks_published_requires_rating check (
        published_at is null or rating is not null
    )
);

create index if not exists checks_org_id_idx on checks (org_id);
create index if not exists checks_submission_id_idx on checks (submission_id);

create table if not exists claims (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    check_id uuid not null references checks (id) on delete cascade,
    text text not null,
    claim_type text not null
        check (claim_type in ('checkable', 'opinion', 'prediction', 'rhetoric')),
    span_start integer,
    span_end integer,
    -- 1536 dims matches common embedding model output (e.g. text-embedding-3-small);
    -- revisit if a different model/dimension is chosen before real ingestion.
    embedding vector(1536),
    created_at timestamptz not null default now()
);

create index if not exists claims_org_id_idx on claims (org_id);
create index if not exists claims_check_id_idx on claims (check_id);
create index if not exists claims_embedding_ivfflat_idx
    on claims using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

create table if not exists demonstrations (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    title text not null,
    -- Ward / sub-county name only -- never coordinates. See
    -- packages/core/src/schemas/demonstration.ts for the matching zod shape.
    area text not null,
    county text not null,
    status text not null
        check (status in ('rumoured', 'announced', 'confirmed', 'ongoing', 'ended', 'cancelled')),
    date date,
    summary text not null,
    source_url text,
    updated_at timestamptz not null default now()
);

create index if not exists demonstrations_org_id_idx on demonstrations (org_id);

create table if not exists llm_calls (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references organizations (id) default '00000000-0000-0000-0000-000000000001',
    stage text not null
        check (stage in ('normalize', 'transcribe', 'extract', 'retrieve', 'draft')),
    model text not null,
    input_tokens integer not null default 0,
    cached_tokens integer not null default 0,
    output_tokens integer not null default 0,
    usd numeric(10, 6) not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists llm_calls_org_id_idx on llm_calls (org_id);
create index if not exists llm_calls_stage_idx on llm_calls (stage);
