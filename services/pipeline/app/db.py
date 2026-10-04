"""The pipeline's first real Postgres connection helper (ADR-0032 two-
engine pivot, migration 0013). Every other store in this service
(InMemoryCheckStore, InMemoryFetchDedupStore, InMemoryIdempotencyStore)
is process-lifetime-only by design (ADR-0009: the real Postgres read
lands at wave-2 integration) — this module IS that wave-2 integration
landing for the fetch engine's persistent dedup store, its outbox
emission path, and its per-engine spend breaker.

`psycopg` (sync, v3) is used rather than `asyncpg` so the connection can
back the existing SYNC `FetchDedupStore` / `EngineCostBreaker` Protocols
without an async-Protocol refactor (see pyproject.toml's dependency
comment). This service is request-scoped and stateless between
requests, so a bare connection-per-call (no pool) is acceptable at this
traffic scale — tracked as tech debt, not hidden: a real deployment
polling at any meaningful cadence should move to a connection pool
(`psycopg_pool`) rather than opening a fresh TCP+TLS handshake per hop
invocation.
"""

from __future__ import annotations

import os

import psycopg


class PipelineDatabaseUnavailableError(RuntimeError):
    """Raised when a Postgres-backed store is required but no
    DATABASE_URL (or DATABASE_URL_DIRECT) is configured — callers
    (app/main.py) decide whether that's fatal (production) or a signal
    to fall back to an in-memory store (local dev / unit tests), never
    this module itself."""


def database_url() -> str | None:
    return os.environ.get("DATABASE_URL_DIRECT") or os.environ.get("DATABASE_URL")


def connect() -> psycopg.Connection:
    """A fresh, autocommit=False connection — callers are responsible
    for an explicit `conn.commit()` (or `with conn.transaction():`) per
    logical operation, same transactional discipline as
    services/api/src/lib/outbox.ts's `db.transaction(...)` callers."""
    url = database_url()
    if not url:
        raise PipelineDatabaseUnavailableError(
            "No DATABASE_URL_DIRECT/DATABASE_URL configured — cannot open a Postgres connection."
        )
    return psycopg.connect(url)


__all__ = ["PipelineDatabaseUnavailableError", "connect", "database_url"]
