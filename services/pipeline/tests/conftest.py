"""Shared fixtures for the Postgres-backed integration tests introduced
by the ADR-0032 fetch-enactment slice (migration 0013). Any test that
needs a real Postgres connection asks for the `pg_conn` fixture below —
it is SKIPPED (not failed) when `DATABASE_URL_TEST` is not set, so the
rest of the suite (and CI runs with no database configured) stays green
without it.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import psycopg
import pytest


@pytest.fixture
def pg_conn() -> Iterator[psycopg.Connection]:
    url = os.environ.get("DATABASE_URL_TEST")
    if not url:
        pytest.skip("DATABASE_URL_TEST not set — skipping Postgres-backed integration test")
    conn = psycopg.connect(url)
    try:
        # A real org row (submissions.org_id / checks.org_id both FK to
        # organizations) -- re-created per test, same default id every
        # existing table already defaults to (ORG_DEFAULT in
        # packages/db/src/schema.ts), so this is idempotent across runs.
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO organizations (id, name) VALUES "
                "('00000000-0000-0000-0000-000000000001', 'default') "
                "ON CONFLICT (id) DO NOTHING"
            )
        conn.commit()
        yield conn
    finally:
        with conn.cursor() as cur:
            # Scoped cleanup of ONLY the tables exclusively owned by
            # this slice's tests (fetch_candidates/fetch_observations/
            # engine_spend_daily — nothing else references them, so a
            # full DELETE here is safe). Deliberately NOT touching
            # `submissions`/`outbox`/`submission_events`: this database
            # is SHARED with services/api's TS integration suite when
            # both run against the same DATABASE_URL_TEST (moon ci runs
            # them against one docker Postgres) — a prior version of
            # this fixture did `DELETE FROM submissions`, which
            # cascaded into TS-created `checks` rows and failed on the
            # `funnel_audit_log` FK restrict (verified empirically: this
            # is exactly what broke `pipeline:test` under `moon ci`,
            # not a hypothetical). tests/test_outbox_postgres.py cleans
            # up its own submissions/outbox/submission_events rows by
            # id instead (see that file).
            cur.execute("DELETE FROM fetch_observations")
            cur.execute("DELETE FROM fetch_candidates")
            cur.execute("DELETE FROM engine_spend_daily")
            # llm_calls (ADR-0011 §7 per-call cost audit) is exclusively owned by
            # this slice's tests and nothing references it, so a full DELETE here
            # is safe — same scoping rationale as the tables above.
            cur.execute("DELETE FROM llm_calls")
        conn.commit()
        conn.close()
