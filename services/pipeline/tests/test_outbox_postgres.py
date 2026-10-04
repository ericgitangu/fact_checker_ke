"""RED->GREEN proof that the fetch hop's provenance now goes through the
REAL outbox (AT-0017-C), not an in-process call into run_analyze_hop.
Requires DATABASE_URL_TEST; skipped otherwise."""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest

from app.stores.outbox_postgres import emit_fetch_submission_received

ORG_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def cleanup_submission(pg_conn) -> Iterator[list[str]]:
    """This module's tests write real `submissions`/`outbox`/
    `submission_events` rows — tables SHARED with services/api's TS
    suite (see tests/conftest.py's `pg_conn` docstring on why the
    shared fixture does not wholesale-delete them). Each test registers
    its own submission id here and this fixture deletes ONLY those
    rows, in FK-safe order, after the test."""
    ids: list[str] = []
    yield ids
    with pg_conn.cursor() as cur:
        for submission_id in ids:
            cur.execute("DELETE FROM submission_events WHERE submission_id = %s", (submission_id,))
            cur.execute("DELETE FROM outbox WHERE aggregate_id = %s", (submission_id,))
            cur.execute("DELETE FROM submissions WHERE id = %s", (submission_id,))
    pg_conn.commit()


def test_emit_writes_submission_outbox_and_submission_events_rows(pg_conn, cleanup_submission) -> None:
    submission_id = emit_fetch_submission_received(pg_conn, org_id=ORG_ID, text="a fetched claim")
    cleanup_submission.append(submission_id)

    with pg_conn.cursor() as cur:
        cur.execute("SELECT ingest_source, text, status FROM submissions WHERE id = %s", (submission_id,))
        row = cur.fetchone()
    assert row == ("fetch", "a fetched claim", "received")

    with pg_conn.cursor() as cur:
        cur.execute(
            "SELECT event_type, payload, published_at FROM outbox WHERE aggregate_id = %s", (submission_id,)
        )
        outbox_row = cur.fetchone()
    assert outbox_row is not None
    event_type, payload, published_at = outbox_row
    assert event_type == "submission.received"
    assert published_at is None  # not yet relayed -- the sweeper's job, proven in the TS integration test
    payload_dict = payload if isinstance(payload, dict) else json.loads(payload)
    assert payload_dict["payload"]["ingest_source"] == "fetch"
    assert payload_dict["submission_id"] == submission_id

    with pg_conn.cursor() as cur:
        cur.execute("SELECT event_type FROM submission_events WHERE submission_id = %s", (submission_id,))
        events_row = cur.fetchone()
    assert events_row == ("submission.received",)


def test_emit_keeps_caller_supplied_submission_id(pg_conn, cleanup_submission) -> None:
    fixed_id = "22222222-2222-2222-2222-222222222222"
    returned_id = emit_fetch_submission_received(pg_conn, org_id=ORG_ID, text="x", submission_id=fixed_id)
    cleanup_submission.append(fixed_id)
    assert returned_id == fixed_id
