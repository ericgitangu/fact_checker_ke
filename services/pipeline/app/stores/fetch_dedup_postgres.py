"""The PERSISTENT replacement for InMemoryFetchDedupStore
(app/stores/fetch_dedup_memory.py), reading/writing `fetch_candidates` /
`fetch_observations` (db/migrations/0013) directly via psycopg (ADR-0009:
Python reads/writes the shared Postgres tables with raw SQL; packages/db's
schema.ts is the single source of truth for the table SHAPE, not for
these writes).

Implements the exact same `FetchDedupStore` Protocol as the in-memory
store, so app/stages/fetch_hop.py needs no change to depend on this
instead — only app/main.py's wiring changes (selects this store when
DATABASE_URL is configured, falls back to the in-memory one otherwise).

This closes the TECH-DEBT gap that store's docstring flagged: dedup state
now survives a Cloud Run instance recycling between QStash-triggered
polls, because it lives in Postgres, not a process-lifetime dict.
"""

from __future__ import annotations

from datetime import datetime

import psycopg

from app.protocols.fetch_dedup_store import (
    FetchCandidateRecord,
    FetchDedupStore,
)


class PostgresFetchDedupStore(FetchDedupStore):
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def seen_platform_item(self, platform: str, native_id: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM fetch_observations WHERE platform = %s AND native_id = %s",
                (platform, native_id),
            )
            return cur.fetchone() is not None

    def record_observation(
        self, *, platform: str, native_id: str, content_hash: str, observed_at: datetime
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO fetch_observations (platform, native_id, content_hash, observed_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (platform, native_id) DO NOTHING
                """,
                (platform, native_id, content_hash, observed_at),
            )
        self._conn.commit()

    def upsert_candidate(
        self, *, content_hash: str, claim_text: str, score: float, platform: str, observed_at: datetime
    ) -> tuple[FetchCandidateRecord, bool]:
        with self._conn.cursor() as cur:
            # A single statement: insert-or-update, with the "is_new"
            # distinction surfaced via `xmax = 0` (true only for a row
            # this very statement inserted, never one it updated) —
            # avoids a separate SELECT-then-branch round trip and the
            # race window that would open between them.
            cur.execute(
                """
                INSERT INTO fetch_candidates
                    (content_hash, claim_text, score,
                     trend_count, platforms_seen, first_observed_at, last_observed_at)
                VALUES (%(content_hash)s, %(claim_text)s, %(score)s,
                        1, ARRAY[%(platform)s], %(observed_at)s, %(observed_at)s)
                ON CONFLICT (content_hash) DO UPDATE SET
                    trend_count = fetch_candidates.trend_count + 1,
                    platforms_seen = CASE
                        WHEN %(platform)s = ANY(fetch_candidates.platforms_seen) THEN fetch_candidates.platforms_seen
                        ELSE array_append(fetch_candidates.platforms_seen, %(platform)s)
                    END,
                    last_observed_at = %(observed_at)s,
                    score = GREATEST(fetch_candidates.score, %(score)s)
                RETURNING
                    content_hash, claim_text, score, status, submission_id, trend_count,
                    platforms_seen, first_observed_at, last_observed_at,
                    (xmax = 0) AS is_new
                """,
                {
                    "content_hash": content_hash,
                    "claim_text": claim_text,
                    "score": score,
                    "platform": platform,
                    "observed_at": observed_at,
                },
            )
            row = cur.fetchone()
        self._conn.commit()
        assert row is not None
        (
            ch,
            text,
            stored_score,
            status,
            submission_id,
            trend_count,
            platforms_seen,
            first_observed_at,
            last_observed_at,
            is_new,
        ) = row
        record = FetchCandidateRecord(
            content_hash=ch,
            claim_text=text,
            score=stored_score,
            status=status,
            # psycopg returns Postgres `uuid` columns as `uuid.UUID`
            # objects, not `str` — the Protocol's `submission_id: str |
            # None` must be honoured exactly (verified empirically: the
            # in-memory store's equivalent field is always a plain str,
            # and a caller comparing against a str id would otherwise
            # silently fail an `==` check, as this module's own test
            # caught before this cast was added).
            submission_id=str(submission_id) if submission_id is not None else None,
            trend_count=trend_count,
            platforms_seen=frozenset(platforms_seen),
            first_observed_at=first_observed_at,
            last_observed_at=last_observed_at,
        )
        return record, bool(is_new)

    def mark_emitted(self, content_hash: str, *, submission_id: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE fetch_candidates SET status = 'emitted', submission_id = %s WHERE content_hash = %s",
                (submission_id, content_hash),
            )
        self._conn.commit()

    def mark_dropped(self, content_hash: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE fetch_candidates SET status = 'dropped' WHERE content_hash = %s AND status = 'pending'",
                (content_hash,),
            )
        self._conn.commit()


__all__ = ["PostgresFetchDedupStore"]
