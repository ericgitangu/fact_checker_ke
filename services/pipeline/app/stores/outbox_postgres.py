"""Closes the AT-0017-C / AT-0032-6 "bypasses the outbox" gap:
app/stages/fetch_hop.py used to call `run_analyze_hop` IN-PROCESS for a
surviving candidate, which never touches `submissions` / `outbox` /
`submission_events` at all, so a fetched item carried no durable
provenance and never went through the real ADR-0017 relay.

This module writes the SAME three rows, in the SAME one-transaction
shape, that services/api/src/lib/submission-service.ts's
`PostgresSubmissionService.createWithIdempotency` writes for a human
submission — but from the Python side, directly against the shared
Postgres database (ADR-0009), with `ingest_source` set to `'fetch'`
instead of relying on the column's default. The existing, REAL
`services/api` outbox relay (`drainOutbox` / the `/internal/outbox/drain`
sweeper, already running in production) picks this row up exactly like
any submission-engine row and POSTs it to the pipeline's own
`/hops/analyze` — so a fetched candidate now flows through the real
relay instead of calling back into this same process synchronously.

Field-for-field parity with the TS writer is deliberate and manually
kept in sync (same cross-language-mirror discipline as framing_guard.py/
tier-c-policy.ts) — there is no shared ORM between the two languages.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

import psycopg


def emit_fetch_submission_received(
    conn: psycopg.Connection,
    *,
    org_id: str,
    text: str,
    submission_id: str | None = None,
) -> str:
    """Inserts `submissions` (ingest_source='fetch'), `outbox`
    (event_type='submission.received'), and `submission_events` in one
    transaction, and returns the submission id. `submission_id`, when
    provided, lets the caller (app/stages/fetch_hop.py) keep the id it
    already generated for its own `EmittedCandidate`/dedup bookkeeping
    rather than discovering a server-generated one after the fact —
    mirrors how a client-supplied idempotency key, not a DB default,
    anchors identity across the rest of this codebase's outbox writers.
    """
    submission_id = submission_id or str(uuid4())
    event_id = str(uuid4())
    # Emit a "Z" suffix (not Python's "+00:00" offset): the api's
    # SubmissionReceivedEventSchema (packages/core events.ts) validates
    # occurred_at with zod .datetime(), which rejects offset timestamps by
    # default -> a fetch-ingested event with "+00:00" 400s at the
    # /internal/hops/orchestrate boundary. Confirmed live 2026-10-05.
    occurred_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    payload = {
        "event_id": event_id,
        "occurred_at": occurred_at,
        "submission_id": submission_id,
        "org_id": org_id,
        "event_type": "submission.received",
        "schema_version": "v1",
        "payload": {
            "url": None,
            "text": text,
            "submitted_by": None,
            "quote": None,
            "timestamp_sec": None,
            "ingest_source": "fetch",
        },
    }

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO submissions (id, org_id, url, text, submitted_by, ingest_source, status)
            VALUES (%s, %s, NULL, %s, NULL, 'fetch', 'received')
            """,
            (submission_id, org_id, text),
        )
        cur.execute(
            """
            INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
            VALUES ('submission', %s, 'submission.received', %s)
            """,
            (submission_id, json.dumps(payload)),
        )
        cur.execute(
            """
            INSERT INTO submission_events (submission_id, event_id, event_type, payload)
            VALUES (%s, %s, 'submission.received', %s)
            """,
            (submission_id, event_id, json.dumps(payload)),
        )
    conn.commit()
    return submission_id


__all__ = ["emit_fetch_submission_received"]
