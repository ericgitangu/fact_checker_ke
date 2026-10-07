"""ADR-0037: re-observation + real velocity behind FETCH_VELOCITY_REOBSERVE.

Exercised through the REAL app/stages/fetch_hop.run_fetch_hop orchestration
(and the real InMemoryFetchDedupStore), never a replica of the logic — the
flip from "dropped" to "emitted" is driven by the actual scorer consuming a
real Δengagement/Δtime, not by an assertion about what the code should do.

Three proofs the task calls for:
  (i)   flag ON: a second observation of the same item is RECORDED (not
        dropped) and a REAL, non-constant velocity is computed — demonstrated
        by a candidate that is below τ on its first (velocity-0) observation
        and only crosses τ on the second because velocity became real.
  (ii)  flag OFF (default): the re-poll is still dropped at layer 1, no
        snapshot recorded — byte-for-byte the pre-ADR-0037 behaviour.
  (iii) flag ON: re-observing an already-emitted item does NOT re-emit it
        (AT-0032-3) — it only attaches an observation.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.fakes.fake_fetch_source import FakeFetchSource
from app.fakes.fake_llm_client import FakeLlmClient
from app.protocols.fetch_dedup_store import FetchObservationHistory
from app.protocols.fetch_source import FetchCandidate
from app.stages.fetch_hop import _velocity_from_history, run_fetch_hop
from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)

# No salience term, no number, no assertion cue -> claim_density 0.2. On its
# own (velocity 0, spread 0.5, recency 1.0) it scores ~0.315, below the
# default τ_fetch of 0.5 — so ONLY a real velocity can push it over.
_NEUTRAL_TEXT = "Just a quiet Tuesday afternoon, nothing much happening."


def _candidate(
    native_id: str, *, observed_at: datetime, engagement: dict[str, int], text: str = _NEUTRAL_TEXT
) -> FetchCandidate:
    return FetchCandidate(
        platform="youtube",
        native_id=native_id,
        title=text[:40],
        text=text,
        url=f"https://example.com/youtube/{native_id}",
        observed_at=observed_at,
        engagement=engagement,
    )


# ---------------------------------------------------------------------------
# Unit: the pure velocity helper computes REAL deltas, not the constants.
# ---------------------------------------------------------------------------


def test_velocity_from_history_first_observation_is_zero_not_error() -> None:
    history = FetchObservationHistory(
        count=0, first_observed_at=None, latest_observed_at=None, latest_engagement={}
    )
    _hours_since_previous, engagement_delta, age_hours = _velocity_from_history(
        history, observed_at=_NOW, total_engagement=100_000.0
    )
    assert engagement_delta == 0.0  # no prior snapshot -> velocity 0, not an error
    assert age_hours == 0.0


def test_velocity_from_history_computes_real_non_constant_deltas() -> None:
    history = FetchObservationHistory(
        count=1,
        first_observed_at=_NOW,
        latest_observed_at=_NOW,
        latest_engagement={"views": 50_000},
    )
    # Current observation 2h later with 250k views -> +200k over 2h.
    hours_since_previous, engagement_delta, age_hours = _velocity_from_history(
        history, observed_at=_NOW + timedelta(hours=2), total_engagement=250_000.0
    )
    assert hours_since_previous == 2.0  # real wall-clock gap, NOT the fake 1.0
    assert engagement_delta == 200_000.0  # real growth, NOT the raw snapshot total
    assert age_hours == 2.0  # real age from first observation, NOT the fake 0.0


def test_velocity_from_history_clamps_an_engagement_dip_to_zero() -> None:
    history = FetchObservationHistory(
        count=1,
        first_observed_at=_NOW,
        latest_observed_at=_NOW,
        latest_engagement={"views": 100_000},
    )
    # A later snapshot reporting FEWER views is not negative virality.
    _, engagement_delta, _ = _velocity_from_history(
        history, observed_at=_NOW + timedelta(hours=1), total_engagement=80_000.0
    )
    assert engagement_delta == 0.0


# ---------------------------------------------------------------------------
# (i) Flag ON: second observation recorded + real velocity flips the outcome.
# ---------------------------------------------------------------------------


async def test_reobserve_on_records_second_observation_and_real_velocity_flips_outcome(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_VELOCITY_REOBSERVE", "true")
    dedup_store = InMemoryFetchDedupStore()
    llm = FakeLlmClient()

    # First observation: no engagement, velocity 0 -> below τ -> dropped.
    first = await run_fetch_hop(
        sources=[FakeFetchSource(platform="youtube", fixtures=[_candidate("vid-1", observed_at=_NOW, engagement={"views": 0})])],
        dedup_store=dedup_store,
        llm=llm,
        org_id="org-1",
    )
    assert first.dropped_below_tau == 1
    assert first.emitted == []

    # Second observation 2h later, +200k views -> velocity ~1.0 -> crosses τ.
    # The item is NOT dropped as a layer-1 duplicate (reobserve is on); the
    # snapshot is recorded and the REAL velocity drives the flip to emitted.
    second = await run_fetch_hop(
        sources=[FakeFetchSource(platform="youtube", fixtures=[_candidate("vid-1", observed_at=_NOW + timedelta(hours=2), engagement={"views": 200_000})])],
        dedup_store=dedup_store,
        llm=llm,
        org_id="org-1",
    )
    assert second.duplicate_platform_item_skipped == 0  # NOT dropped at layer 1
    assert len(second.emitted) == 1  # velocity-driven flip, dropped -> emitted

    # Both observations were actually recorded as a time-series (the whole
    # point: the same (platform, native_id) stored more than once).
    history = dedup_store.observation_history("youtube", "vid-1")
    assert history.count == 2


# ---------------------------------------------------------------------------
# (ii) Flag OFF: the re-poll is still dropped, no snapshot recorded.
# ---------------------------------------------------------------------------


async def test_reobserve_off_by_default_drops_the_repoll(monkeypatch) -> None:
    # Default: env var unset. The pre-ADR-0037 behaviour must be unchanged.
    monkeypatch.delenv("FETCH_VELOCITY_REOBSERVE", raising=False)
    dedup_store = InMemoryFetchDedupStore()
    llm = FakeLlmClient()
    high_engagement = {"views": 500_000}
    text = "Ruto announced fuel tax will rise by 10% starting Monday."

    first = await run_fetch_hop(
        sources=[FakeFetchSource(platform="youtube", fixtures=[_candidate("vid-9", observed_at=_NOW, engagement=high_engagement, text=text)])],
        dedup_store=dedup_store,
        llm=llm,
        org_id="org-1",
    )
    assert len(first.emitted) == 1

    second = await run_fetch_hop(
        sources=[FakeFetchSource(platform="youtube", fixtures=[_candidate("vid-9", observed_at=_NOW + timedelta(hours=2), engagement={"views": 900_000}, text=text)])],
        dedup_store=dedup_store,
        llm=llm,
        org_id="org-1",
    )
    assert second.duplicate_platform_item_skipped == 1  # dropped at layer 1, unchanged
    assert second.emitted == []
    # OFF path records only the layer-1 "seen" marker, never an engagement
    # snapshot — so there is no velocity time-series (byte-for-byte old path).
    assert dedup_store.observation_history("youtube", "vid-9").count == 0


async def test_reobserve_off_explicit_false_matches_default(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_VELOCITY_REOBSERVE", "false")
    dedup_store = InMemoryFetchDedupStore()
    source = FakeFetchSource(
        platform="youtube",
        fixtures=[_candidate("vid-7", observed_at=_NOW, engagement={"views": 500_000}, text="Ruto confirmed the policy will change.")],
    )
    first = await run_fetch_hop(sources=[source], dedup_store=dedup_store, llm=FakeLlmClient(), org_id="org-1")
    assert len(first.emitted) == 1
    again = await run_fetch_hop(sources=[source], dedup_store=dedup_store, llm=FakeLlmClient(), org_id="org-1")
    assert again.duplicate_platform_item_skipped == 1
    assert again.emitted == []


# ---------------------------------------------------------------------------
# (iii) Flag ON: re-observing an emitted item does NOT re-emit (AT-0032-3).
# ---------------------------------------------------------------------------


async def test_reobserve_on_does_not_re_emit_an_already_emitted_item(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_VELOCITY_REOBSERVE", "true")
    dedup_store = InMemoryFetchDedupStore()
    llm = FakeLlmClient()
    # High-scoring text so it emits on the FIRST observation, independent of
    # velocity — we are proving re-observation of an emitted claim never
    # re-emits, not the flip.
    text = "Ruto announced fuel tax will rise by 10% starting Monday."

    first = await run_fetch_hop(
        sources=[FakeFetchSource(platform="youtube", fixtures=[_candidate("vid-2", observed_at=_NOW, engagement={"views": 100_000}, text=text)])],
        dedup_store=dedup_store,
        llm=llm,
        org_id="org-1",
    )
    assert len(first.emitted) == 1
    emitted_submission_id = first.emitted[0].submission_id

    # Re-observe the SAME item twice more with growing engagement. Each is
    # recorded (velocity/trend update) but MUST NOT produce a new emission —
    # it attaches an observation only, because the candidate is `emitted`.
    for hours, views in ((2, 400_000), (4, 900_000)):
        again = await run_fetch_hop(
            sources=[FakeFetchSource(platform="youtube", fixtures=[_candidate("vid-2", observed_at=_NOW + timedelta(hours=hours), engagement={"views": views}, text=text)])],
            dedup_store=dedup_store,
            llm=llm,
            org_id="org-1",
        )
        assert again.emitted == []
        assert again.attached_observation_only == 1

    # The emitted candidate still points at the one, original submission id,
    # and all three observations were recorded as a time-series.
    record, is_new = dedup_store.upsert_candidate(
        content_hash=first.emitted[0].content_hash,
        claim_text="x",
        score=0.9,
        platform="youtube",
        observed_at=_NOW,
    )
    assert is_new is False
    assert record.status == "emitted"
    assert record.submission_id == emitted_submission_id
    assert dedup_store.observation_history("youtube", "vid-2").count == 3
