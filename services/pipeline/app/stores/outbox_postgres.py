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
import math
from datetime import UTC, datetime
from uuid import uuid4

import psycopg

# Feed-quality (virality) weights: scarcer, higher-effort engagement signals
# count for more than cheap ones — a comment (someone wrote something) weighs
# more than a like (one tap), which weighs more than a view (autoplay/scroll).
# `log1p` (= ln(1+x)) damps the raw-count dominance of view counts so a video
# with 10M views doesn't drown out a hotly-argued 50k-view clip. The score is
# therefore `1·ln(1+views) + 2·ln(1+likes) + 3·ln(1+comments)`, a single
# monotonic number used only for RELATIVE ranking of the "most viral" feed
# section (never shown as an absolute figure), rounded to 4dp to match the
# `numeric(12,4)` column it lands in (packages/db checks.virality_score).
_VIRALITY_WEIGHTS = {"views": 1.0, "likes": 2.0, "comments": 3.0}


def compute_virality_score(engagement: dict[str, int] | None) -> float | None:
    """Collapse raw engagement counts to one log-weighted virality score, or
    None when there is no engagement at all (a submission-sourced item, or a
    fetch item a source returned with no counts) — the "most viral" ranking
    EXCLUDES nulls rather than treating absent engagement as a zero. An
    all-zero engagement dict is a real 0.0 (a fetch item that genuinely has no
    traction yet), distinct from None."""
    if not engagement:
        return None
    score = 0.0
    for key, weight in _VIRALITY_WEIGHTS.items():
        raw = engagement.get(key, 0) or 0
        count = max(0, int(raw))
        score += weight * math.log1p(count)
    return round(score, 4)


def emit_fetch_submission_received(
    conn: psycopg.Connection,
    *,
    org_id: str,
    text: str,
    submission_id: str | None = None,
    engagement: dict[str, int] | None = None,
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
    # Normalize the raw engagement to the three keys the event contract
    # (packages/core SubmissionReceivedEventSchema.payload.engagement) and the
    # virality formula agree on; None stays None (no engagement observed).
    engagement_payload = (
        {
            "views": max(0, int(engagement.get("views", 0) or 0)),
            "likes": max(0, int(engagement.get("likes", 0) or 0)),
            "comments": max(0, int(engagement.get("comments", 0) or 0)),
        }
        if engagement
        else None
    )
    virality_score = compute_virality_score(engagement)
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
            # Feed-quality (virality): carry the raw counts for provenance and
            # the single derived score the API persists on the published check.
            "engagement": engagement_payload,
            "virality_score": virality_score,
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


__all__ = ["compute_virality_score", "emit_fetch_submission_received"]
