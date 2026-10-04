"""ADR-0032/0005 AT-0032-4 / AT-0005-5: the fetch engine's STT compliance
boundary, exercised through the real app/stages/fetch_hop.run_fetch_hop
orchestration — not a replica of its gating logic.

Proves two things concretely:
  1. A fetched item with NO claim-bearing text and an audio/video track
     that is NOT in the lawful/compliant subset (`stt_eligible=False`,
     the ordinary third-party YouTube/TikTok case) is blocked before
     scoring, before the transcriber, and before the LLM -- zero STT
     calls AND zero LLM calls, proven via a spy on both fakes, not
     inferred from "the code looks like it returns early".
  2. A fetched item in the compliant subset (`stt_eligible=True` --
     owner-authorized / partner / open-licensed / live-capture) DOES
     get transcribed, and the transcribed text flows through to
     scoring/emission like ordinary claim text.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.fakes.fake_fetch_source import FakeFetchSource
from app.fakes.fake_llm_client import FakeLlmClient
from app.fakes.fake_transcriber import FakeTranscriber
from app.protocols.fetch_source import FetchCandidate
from app.protocols.transcriber import TranscriptionResult
from app.stages.fetch_hop import run_fetch_hop
from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)


class _SpyTranscriber(FakeTranscriber):
    """Wraps FakeTranscriber (never a real vendor call) and counts
    invocations, so a test can assert zero calls empirically rather than
    by reading the gating code and trusting it."""

    def __init__(self) -> None:
        self.call_count = 0

    async def transcribe(self, audio_url: str) -> TranscriptionResult:
        self.call_count += 1
        return await super().transcribe(audio_url)


def _audio_only_candidate(*, native_id: str, stt_eligible: bool) -> FetchCandidate:
    return FetchCandidate(
        platform="youtube",
        native_id=native_id,
        title="",
        text="",  # no claim-bearing text at all -- audio-only item
        url=f"https://example.com/youtube/{native_id}",
        observed_at=_NOW,
        engagement={"views": 100_000},
        audio_url=f"https://example.com/youtube/{native_id}.audio",
        stt_eligible=stt_eligible,
    )


async def test_non_compliant_audio_only_item_is_blocked_with_zero_stt_and_zero_llm_calls() -> None:
    source = FakeFetchSource(
        platform="youtube",
        fixtures=[_audio_only_candidate(native_id="vid-noncompliant", stt_eligible=False)],
    )
    llm = FakeLlmClient()
    transcriber = _SpyTranscriber()

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=llm,
        org_id="org-1",
        transcriber=transcriber,
    )

    assert result.candidates_observed == 1
    assert result.blocked_non_compliant_media_needs_quote == 1
    assert len(result.emitted) == 0
    # The empirical proof: neither fake was ever called for this item.
    assert transcriber.call_count == 0
    assert llm.call_count == 0


async def test_no_transcriber_wired_also_blocks_even_when_stt_eligible() -> None:
    # Fail-closed: `stt_eligible=True` is a necessary but not sufficient
    # condition -- with no transcriber configured at all (e.g. STT
    # disabled in this deployment), the item is still blocked rather
    # than silently treated as checkable with empty text.
    source = FakeFetchSource(
        platform="youtube",
        fixtures=[_audio_only_candidate(native_id="vid-no-transcriber", stt_eligible=True)],
    )
    llm = FakeLlmClient()

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=llm,
        org_id="org-1",
        transcriber=None,
    )

    assert result.blocked_non_compliant_media_needs_quote == 1
    assert len(result.emitted) == 0
    assert llm.call_count == 0


async def test_compliant_subset_item_is_transcribed_and_flows_through_to_emission() -> None:
    source = FakeFetchSource(
        platform="youtube",
        fixtures=[_audio_only_candidate(native_id="vid-compliant", stt_eligible=True)],
    )
    llm = FakeLlmClient()
    transcriber = _SpyTranscriber()

    result = await run_fetch_hop(
        sources=[source],
        dedup_store=InMemoryFetchDedupStore(),
        llm=llm,
        org_id="org-1",
        transcriber=transcriber,
    )

    assert result.blocked_non_compliant_media_needs_quote == 0
    assert transcriber.call_count == 1
    # The fake transcript is claim-dense enough to score above tau with
    # the default scoring config (same fixture text used across the
    # transcriber fakes) -- proven by checking it was actually emitted,
    # not dropped, i.e. the transcribed text really reached scoring.
    assert len(result.emitted) == 1
    assert "stubbed transcription" in result.emitted[0].claim_text
