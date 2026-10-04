"""RED->GREEN proof that PostgresFetchDedupStore survives "process
recycling" — the exact gap InMemoryFetchDedupStore's TECH-DEBT docstring
flagged. Requires DATABASE_URL_TEST (see tests/conftest.py); skipped
otherwise."""

from __future__ import annotations

from datetime import UTC, datetime

from app.stores.fetch_dedup_postgres import PostgresFetchDedupStore


def test_seen_platform_item_persists_across_a_fresh_store_instance(pg_conn) -> None:
    store = PostgresFetchDedupStore(pg_conn)
    assert store.seen_platform_item("youtube", "vid-1") is False
    store.record_observation(
        platform="youtube", native_id="vid-1", content_hash="hash-a", observed_at=datetime.now(UTC)
    )

    # A BRAND NEW store instance against the SAME connection/database —
    # simulating a Cloud Run instance recycle, which is exactly what
    # InMemoryFetchDedupStore could never survive (a fresh instance there
    # would be a fresh, empty dict).
    fresh_store = PostgresFetchDedupStore(pg_conn)
    assert fresh_store.seen_platform_item("youtube", "vid-1") is True


def test_upsert_candidate_is_new_then_not_new_and_keeps_higher_score(pg_conn) -> None:
    store = PostgresFetchDedupStore(pg_conn)
    now = datetime.now(UTC)

    record, is_new = store.upsert_candidate(
        content_hash="hash-b", claim_text="claim text", score=0.5, platform="youtube", observed_at=now
    )
    assert is_new is True
    assert record.trend_count == 1
    assert record.platforms_seen == frozenset({"youtube"})

    record2, is_new2 = store.upsert_candidate(
        content_hash="hash-b", claim_text="claim text", score=0.3, platform="tiktok", observed_at=now
    )
    assert is_new2 is False
    assert record2.trend_count == 2
    assert record2.platforms_seen == frozenset({"youtube", "tiktok"})
    # A lower-scoring re-poll (0.3 < 0.5) must never downgrade the
    # stored score (ADR-0032 §3 contract, same as the in-memory store).
    assert record2.score == 0.5


def test_mark_emitted_then_mark_dropped_is_a_noop_once_emitted(pg_conn) -> None:
    store = PostgresFetchDedupStore(pg_conn)
    now = datetime.now(UTC)
    store.upsert_candidate(content_hash="hash-c", claim_text="t", score=0.9, platform="youtube", observed_at=now)
    store.mark_emitted("hash-c", submission_id="11111111-1111-1111-1111-111111111111")

    # A fresh instance again -- the "emitted" status itself must persist,
    # which is what lets app/stages/fetch_hop.py's re-poll path detect
    # "already emitted, attach observation only" after an instance
    # recycle (AT-0032-3).
    fresh_store = PostgresFetchDedupStore(pg_conn)
    record, is_new = fresh_store.upsert_candidate(
        content_hash="hash-c", claim_text="t", score=0.1, platform="tiktok", observed_at=now
    )
    assert is_new is False
    assert record.status == "emitted"
    assert record.submission_id == "11111111-1111-1111-1111-111111111111"

    fresh_store.mark_dropped("hash-c")
    final_record, _ = fresh_store.upsert_candidate(
        content_hash="hash-c", claim_text="t", score=0.1, platform="x", observed_at=now
    )
    # mark_dropped is a no-op once status is already "emitted" (per the
    # Protocol's contract) -- status must still read "emitted".
    assert final_record.status == "emitted"
