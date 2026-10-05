"""AT-0032-5 (breaker wiring) + AT-0017-C (real-outbox emission wiring),
exercised through the real `run_fetch_hop` orchestration — not a replica
of fetch_hop.py's internals."""

from __future__ import annotations

from datetime import UTC, datetime

from app.fakes.fake_fetch_source import FakeFetchSource
from app.fakes.fake_llm_client import FakeLlmClient
from app.protocols.fetch_source import FetchCandidate
from app.stages.fetch_hop import run_fetch_hop
from app.stores.engine_breaker import InMemoryEngineCostBreaker
from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
_HIGH_SCORE_TEXT = "Ruto announced fuel tax will rise by 10% starting Monday."


def _candidate(platform: str, native_id: str) -> FetchCandidate:
    return FetchCandidate(
        platform=platform,
        native_id=native_id,
        title=_HIGH_SCORE_TEXT[:40],
        text=_HIGH_SCORE_TEXT,
        url=f"https://example.com/{platform}/{native_id}",
        observed_at=_NOW,
        engagement={"views": 100_000},
    )


async def test_hard_stopped_breaker_skips_polling_every_source_entirely(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "1.00")
    breaker = InMemoryEngineCostBreaker()
    breaker.record_spend("fetch", 1.00)  # already at 100%

    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-1")])
    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=FakeLlmClient(),
        org_id="org-1",
        cost_breaker=breaker,
    )

    assert result.hard_stopped is True
    assert result.candidates_observed == 0
    assert source.poll_count == 0  # never even polled


async def test_soft_stopped_breaker_still_dedups_but_skips_emission(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "1.00")
    breaker = InMemoryEngineCostBreaker()
    breaker.record_spend("fetch", 0.80)  # exactly 80% -- soft-stopped, not hard-stopped

    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-1")])
    dedup_store = InMemoryFetchDedupStore()
    result = await run_fetch_hop(
        sources=[source],
        dedup_store=dedup_store,
        llm=FakeLlmClient(),
        org_id="org-1",
        cost_breaker=breaker,
    )

    assert result.hard_stopped is False
    assert source.poll_count == 1  # polling continued
    assert result.candidates_observed == 1
    assert result.skipped_soft_stopped == 1
    assert len(result.emitted) == 0  # emission was skipped
    # Dedup/trend bookkeeping continued regardless (AT-0032-5's
    # "dedup/trend updates continue"): the claim is now tracked.
    assert dedup_store.seen_platform_item("youtube", "vid-1") is True


async def test_emit_submission_strategy_is_used_instead_of_run_analyze_hop() -> None:
    captured: list[tuple[str, str, str, dict[str, int]]] = []

    def _fake_emit(
        claim_text: str, org_id: str, submission_id: str, engagement: dict[str, int]
    ) -> str:
        captured.append((claim_text, org_id, submission_id, engagement))
        return f"server-{submission_id}"

    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-1")])
    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=FakeLlmClient(),
        org_id="org-1",
        emit_submission=_fake_emit,
    )

    assert len(captured) == 1
    assert captured[0][0] == _HIGH_SCORE_TEXT
    assert captured[0][1] == "org-1"
    # The raw engagement observed on the candidate is threaded through to the
    # real-outbox emitter (for the virality score) rather than dropped.
    assert captured[0][3] == {"views": 100_000}
    assert len(result.emitted) == 1
    # The strategy's returned id (not the locally-generated uuid) is
    # what ends up on the EmittedCandidate -- proves the real-outbox
    # path's id, not an in-process analyze result, is authoritative.
    assert result.emitted[0].submission_id.startswith("server-")
    assert result.emitted[0].analyze_result is None
