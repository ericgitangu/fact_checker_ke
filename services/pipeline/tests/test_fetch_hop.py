"""Acceptance tests for the `fetch` hop (ADR-0032 AT-0032-1/2/3), exercised
through the real app/stages/fetch_hop.run_fetch_hop orchestration — not a
replica of its logic.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx

from app.clients.fetch_source_factory import make_fetch_sources
from app.clients.triage_feed_source import TRIAGE_FEED_URLS_ENV
from app.clients.youtube_fetch_source import YOUTUBE_API_KEY_ENV
from app.fakes.fake_fetch_source import FakeFetchSource
from app.fakes.fake_llm_client import FakeLlmClient
from app.protocols.fetch_source import FetchCandidate, FetchSourceError
from app.stages.fetch_hop import run_fetch_hop
from app.stages.fetch_scoring import FetchScoringConfig
from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)

_HIGH_SCORE_TEXT = "Ruto announced fuel tax will rise by 10% starting Monday."
_LOW_SCORE_TEXT = "Just a quiet Tuesday afternoon, nothing much happening."


def _candidate(
    platform: str, native_id: str, *, text: str = _HIGH_SCORE_TEXT, engagement: dict[str, int] | None = None
) -> FetchCandidate:
    return FetchCandidate(
        platform=platform,
        native_id=native_id,
        title=text[:40],
        text=text,
        url=f"https://example.com/{platform}/{native_id}",
        observed_at=_NOW,
        engagement={"views": 100_000} if engagement is None else engagement,
    )


# ---------------------------------------------------------------------------
# AT-0032-1: fakes-first, zero outbound.
# ---------------------------------------------------------------------------


async def test_at_0032_1_engine_runs_end_to_end_on_fakes_with_zero_outbound_http(monkeypatch) -> None:
    def _must_not_construct(*_args: object, **_kwargs: object) -> None:
        raise AssertionError(
            "httpx.AsyncClient was constructed — a real platform client made an "
            "outbound call even though no platform API key/env was configured"
        )

    # RED without this test: nothing previously proved the fetch engine makes
    # zero outbound calls on fakes; GREEN below is the real assertion, not an
    # inference from "FakeFetchSource looks safe by inspection".
    monkeypatch.setattr(httpx, "AsyncClient", _must_not_construct)

    source = FakeFetchSource(
        platform="youtube",
        fixtures=[
            _candidate("youtube", "vid-1"),
            _candidate("youtube", "vid-2", text=_LOW_SCORE_TEXT, engagement={}),
        ],
    )
    llm = FakeLlmClient()

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=llm,
        org_id="org-1",
    )

    # The spy didn't fire (no exception propagated) AND the engine actually
    # did real work on the fake fixtures -- proves "ran end-to-end", not
    # "did nothing so nothing could leak out".
    assert result.candidates_observed == 2
    assert len(result.emitted) == 1
    assert result.dropped_below_tau == 1
    assert source.poll_count == 1


async def test_at_0032_1_factory_selected_fakes_also_make_zero_outbound_calls(monkeypatch) -> None:
    monkeypatch.delenv(YOUTUBE_API_KEY_ENV, raising=False)
    monkeypatch.delenv(TRIAGE_FEED_URLS_ENV, raising=False)

    def _must_not_construct(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("httpx.AsyncClient was constructed with no platform keys configured")

    monkeypatch.setattr(httpx, "AsyncClient", _must_not_construct)

    sources = make_fetch_sources()
    result = await run_fetch_hop(
        sources=sources,
        dedup_store=InMemoryFetchDedupStore(),
        llm=FakeLlmClient(),
        org_id="org-1",
    )
    # Default fakes have empty fixtures -- zero candidates is the correct,
    # safe-by-default outcome, and still zero outbound calls were made.
    assert result.candidates_observed == 0


# ---------------------------------------------------------------------------
# AT-0032-2: τ_fetch drops below-threshold candidates before any LLM call.
# ---------------------------------------------------------------------------


async def test_at_0032_2_below_tau_candidate_dropped_before_any_llm_call() -> None:
    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-low", text=_LOW_SCORE_TEXT, engagement={})])
    llm = FakeLlmClient()

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=llm,
        org_id="org-1",
    )

    assert result.dropped_below_tau == 1
    assert result.emitted == []
    # The real proof: the LLM was never invoked for this candidate at all.
    assert llm.call_count == 0


async def test_at_0032_2_above_tau_candidate_is_emitted_and_llm_is_called() -> None:
    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-high")])
    llm = FakeLlmClient()

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=llm,
        org_id="org-1",
    )

    assert result.dropped_below_tau == 0
    assert len(result.emitted) == 1
    assert llm.call_count > 0


async def test_at_0032_2_tau_is_config_zero_code_change_retune() -> None:
    # Same candidate that is below the default tau; lowering FETCH_TAU to 0
    # via config alone makes it survive, with no code change.
    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-low", text=_LOW_SCORE_TEXT, engagement={})])
    lenient_config = FetchScoringConfig(
        tau_fetch=0.0,
        weight_velocity=0.3,
        weight_spread=0.25,
        weight_claim_density=0.2,
        weight_recency=0.15,
        weight_salience=0.1,
    )

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        scoring_config=lenient_config,
        llm=FakeLlmClient(),
        org_id="org-1",
    )

    assert result.dropped_below_tau == 0
    assert len(result.emitted) == 1


# ---------------------------------------------------------------------------
# AT-0032-3: one emission per claim identity, regardless of platform count
# or re-poll count.
# ---------------------------------------------------------------------------


async def test_at_0032_3_same_claim_on_two_platforms_emits_exactly_once() -> None:
    youtube = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-1")])
    triage = FakeFetchSource(platform="triage_feed", fixtures=[_candidate("triage_feed", "feed-1")])

    result = await run_fetch_hop(
        sources=[youtube, triage],
        dedup_store=InMemoryFetchDedupStore(),
        llm=FakeLlmClient(),
        org_id="org-1",
    )

    assert result.candidates_observed == 2
    assert len(result.emitted) == 1
    assert result.attached_observation_only == 1
    assert result.duplicate_platform_item_skipped == 0


async def test_at_0032_3_same_item_observed_many_times_emits_exactly_once() -> None:
    dedup_store = InMemoryFetchDedupStore()
    llm = FakeLlmClient()
    source = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-1")])

    first = await run_fetch_hop(sources=[source], dedup_store=dedup_store, llm=llm, org_id="org-1")
    assert len(first.emitted) == 1

    # Simulate 500 further observations of the exact same platform item
    # (re-polls / repeated cron ticks): each must be dropped at layer 1
    # (platform-item identity), never re-scored, never re-emitted.
    total_duplicate_skips = 0
    for _ in range(500):
        again = await run_fetch_hop(sources=[source], dedup_store=dedup_store, llm=llm, org_id="org-1")
        assert again.emitted == []
        total_duplicate_skips += again.duplicate_platform_item_skipped

    assert total_duplicate_skips == 500
    assert source.poll_count == 501


async def test_at_0032_3_max_emissions_per_run_caps_further_emissions() -> None:
    fixtures = [
        _candidate("youtube", f"vid-{i}", text=f"{_HIGH_SCORE_TEXT} Unique marker {i}.")
        for i in range(3)
    ]
    source = FakeFetchSource(platform="youtube", fixtures=fixtures)

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=FakeLlmClient(),
        org_id="org-1",
        max_emissions_per_run=2,
    )

    assert len(result.emitted) == 2
    assert result.capped_by_max_emissions == 1


async def test_failing_source_is_isolated_not_fatal() -> None:
    """ADR-0037 regression: a single source raising FetchSourceError (a 403'd RSS
    feed, a YouTube quota error) must be skipped, never abort the whole engine.
    Before the per-source try/except, one bad source 500'd the entire fetch hop."""

    class _BoomSource:
        platform = "triage_feed"

        async def poll(self, *, limit: int = 20) -> list[FetchCandidate]:
            raise FetchSourceError("feed 403 behind Cloudflare")

    good = FakeFetchSource(platform="youtube", fixtures=[_candidate("youtube", "vid-high")])
    result = await run_fetch_hop(
        sources=[_BoomSource(), good],  # bad source first — must not block the good one
        dedup_store=InMemoryFetchDedupStore(),
        llm=FakeLlmClient(),
        org_id="org-1",
    )
    assert result.candidates_observed == 1  # the good source still ran end-to-end
    assert len(result.emitted) == 1
    assert good.poll_count == 1
