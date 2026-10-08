"""ADR-0038 enrichment: a bare video URL with no quote becomes checkable from
LAWFUL publisher metadata (title+description) instead of dead-ending at
needs_quote — flag-gated, metadata-only (NOT a transcript), fence intact.
"""

from __future__ import annotations

from app.clients.youtube_fetch_source import _video_id_from_url
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.hop_requests import AnalyzeHopRequest, HopContent
from app.protocols.video_metadata import VideoMetadata
from app.stages.analyze import run_analyze_hop


class _FakeFetcher:
    def __init__(self, meta: VideoMetadata | None) -> None:
        self._meta = meta
        self.calls = 0

    async def fetch_metadata(self, url: str) -> VideoMetadata | None:
        self.calls += 1
        return self._meta


def _req(url: str) -> AnalyzeHopRequest:
    return AnalyzeHopRequest(submission_id="s", org_id="o", content=HopContent(url=url))


_META = VideoMetadata(
    resolved_url="https://www.youtube.com/watch?v=vid",
    title="Ruto announced a 16% VAT increase takes effect today",
    description="KTN News reports the Finance Act change and its impact on fuel prices.",
    published_at="2026-10-08T06:00:00Z",
    channel="KTN News Kenya",
)


def test_video_id_parsing() -> None:
    assert _video_id_from_url("https://www.youtube.com/watch?v=abc123") == "abc123"
    assert _video_id_from_url("https://youtu.be/xyz789") == "xyz789"
    assert _video_id_from_url("https://www.youtube.com/shorts/short99") == "short99"
    assert _video_id_from_url("https://www.youtube.com/embed/emb77") == "emb77"
    assert _video_id_from_url("https://example.com/foo") is None
    assert _video_id_from_url("https://www.youtube.com/channel/UC123") is None


async def test_enrichment_off_still_needs_quote() -> None:
    # Default OFF (env unset) -> byte-for-byte unchanged: the fetcher is not even
    # consulted and the hop returns needs_quote.
    fetcher = _FakeFetcher(_META)
    res = await run_analyze_hop(_req("https://youtu.be/x"), llm=FakeLlmClient(), metadata_fetcher=fetcher)
    assert res.needs_quote is True
    assert fetcher.calls == 0


async def test_enrichment_on_uses_metadata(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("ENRICH_VIDEO_METADATA", "true")
    fetcher = _FakeFetcher(_META)
    res = await run_analyze_hop(
        _req("https://www.youtube.com/watch?v=vid"), llm=FakeLlmClient(), metadata_fetcher=fetcher
    )
    assert fetcher.calls == 1
    # Enriched: the hop proceeded through the normal analyze path (NOT a
    # needs_quote dead-end), and the metadata is marked uploader-framing.
    assert res.needs_quote is not True
    assert res.attribution == "unverified"


async def test_enrichment_on_no_metadata_falls_back_to_needs_quote(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("ENRICH_VIDEO_METADATA", "true")
    fetcher = _FakeFetcher(None)  # unresolvable / non-YouTube / API miss
    res = await run_analyze_hop(_req("https://youtu.be/x"), llm=FakeLlmClient(), metadata_fetcher=fetcher)
    assert res.needs_quote is True
