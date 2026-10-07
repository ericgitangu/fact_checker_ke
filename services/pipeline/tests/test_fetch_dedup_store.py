"""Unit tests for InMemoryFetchDedupStore against the FetchDedupStore
Protocol contract (app/protocols/fetch_dedup_store.py) — the three-layer
dedup primitives app/stages/fetch_hop.py's AT-0032-3 behavior is built on.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore

_T0 = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
_T1 = datetime(2026, 10, 4, 13, 0, tzinfo=UTC)


def test_seen_platform_item_false_until_recorded() -> None:
    store = InMemoryFetchDedupStore()
    assert store.seen_platform_item("youtube", "abc123") is False
    store.record_observation(platform="youtube", native_id="abc123", content_hash="h1", observed_at=_T0)
    assert store.seen_platform_item("youtube", "abc123") is True


def test_record_observation_is_idempotent() -> None:
    store = InMemoryFetchDedupStore()
    store.record_observation(platform="youtube", native_id="abc123", content_hash="h1", observed_at=_T0)
    store.record_observation(platform="youtube", native_id="abc123", content_hash="h1", observed_at=_T1)
    assert store.seen_platform_item("youtube", "abc123") is True


def test_upsert_candidate_new_content_hash_is_new() -> None:
    store = InMemoryFetchDedupStore()
    record, is_new = store.upsert_candidate(
        content_hash="h1", claim_text="claim text", score=0.7, platform="youtube", observed_at=_T0
    )
    assert is_new is True
    assert record.trend_count == 1
    assert record.platforms_seen == frozenset({"youtube"})
    assert record.status == "pending"


def test_upsert_candidate_existing_bumps_trend_and_platforms() -> None:
    store = InMemoryFetchDedupStore()
    store.upsert_candidate(content_hash="h1", claim_text="claim text", score=0.7, platform="youtube", observed_at=_T0)
    record, is_new = store.upsert_candidate(
        content_hash="h1", claim_text="claim text", score=0.6, platform="triage_feed", observed_at=_T1
    )
    assert is_new is False
    assert record.trend_count == 2
    assert record.platforms_seen == frozenset({"youtube", "triage_feed"})
    # A later, lower-scoring re-poll must never downgrade the stored score.
    assert record.score == 0.7


def test_upsert_candidate_keeps_the_higher_score_either_direction() -> None:
    store = InMemoryFetchDedupStore()
    store.upsert_candidate(content_hash="h1", claim_text="t", score=0.3, platform="youtube", observed_at=_T0)
    record, _ = store.upsert_candidate(content_hash="h1", claim_text="t", score=0.9, platform="youtube", observed_at=_T1)
    assert record.score == 0.9


def test_mark_emitted_then_dropped_leaves_status_emitted() -> None:
    store = InMemoryFetchDedupStore()
    store.upsert_candidate(content_hash="h1", claim_text="t", score=0.7, platform="youtube", observed_at=_T0)
    store.mark_emitted("h1", submission_id="sub-1")
    store.mark_dropped("h1")  # must be a no-op once emitted
    record, _ = store.upsert_candidate(content_hash="h1", claim_text="t", score=0.1, platform="youtube", observed_at=_T1)
    assert record.status == "emitted"
    assert record.submission_id == "sub-1"


def test_mark_dropped_on_pending_sets_dropped() -> None:
    store = InMemoryFetchDedupStore()
    store.upsert_candidate(content_hash="h1", claim_text="t", score=0.1, platform="youtube", observed_at=_T0)
    store.mark_dropped("h1")
    record, _ = store.upsert_candidate(content_hash="h1", claim_text="t", score=0.1, platform="youtube", observed_at=_T1)
    assert record.status == "dropped"


# ADR-0037: engagement-snapshot time-series (the inputs real velocity needs).


def test_observation_history_empty_before_any_snapshot() -> None:
    store = InMemoryFetchDedupStore()
    history = store.observation_history("youtube", "vid-1")
    assert history.count == 0
    assert history.first_observed_at is None
    assert history.latest_observed_at is None
    assert history.latest_engagement == {}


def test_record_engagement_snapshot_appends_a_time_series() -> None:
    store = InMemoryFetchDedupStore()
    store.record_engagement_snapshot(
        platform="youtube", native_id="vid-1", content_hash="h1", observed_at=_T0, engagement={"views": 100}
    )
    store.record_engagement_snapshot(
        platform="youtube", native_id="vid-1", content_hash="h1", observed_at=_T1, engagement={"views": 900}
    )
    history = store.observation_history("youtube", "vid-1")
    assert history.count == 2  # both recorded — re-observation is possible
    assert history.first_observed_at == _T0
    assert history.latest_observed_at == _T1
    assert history.latest_engagement == {"views": 900}  # most recent snapshot
    # A snapshot also marks the item as seen (layer-1 consistency).
    assert store.seen_platform_item("youtube", "vid-1") is True
