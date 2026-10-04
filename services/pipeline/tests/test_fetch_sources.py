"""AT-0032-1 (fakes-first, zero outbound): with no platform API keys set,
app/clients/fetch_source_factory.make_fetch_sources returns FakeFetchSource
for every platform, and a real client (YouTubeFetchSource/TriageFeedSource)
is only ever constructed when its activating env var is present.

The zero-outbound-call proof itself (no HTTP leaves the process) lives in
test_fetch_hop.py's test_at_0032_1_* — this file proves the *selection*
logic that makes that possible.
"""

from __future__ import annotations

import pytest

from app.clients.fetch_source_factory import make_fetch_sources
from app.clients.triage_feed_source import TRIAGE_FEED_URLS_ENV, TriageFeedSource
from app.clients.youtube_fetch_source import YOUTUBE_API_KEY_ENV, YouTubeFetchSource
from app.fakes.fake_fetch_source import FakeFetchSource
from app.protocols.fetch_source import FetchSourceError


def test_no_keys_set_yields_all_fakes(monkeypatch) -> None:
    monkeypatch.delenv(YOUTUBE_API_KEY_ENV, raising=False)
    monkeypatch.delenv(TRIAGE_FEED_URLS_ENV, raising=False)

    sources = make_fetch_sources()

    assert len(sources) == 4
    assert all(isinstance(s, FakeFetchSource) for s in sources)
    assert {s.platform for s in sources} == {"youtube", "triage_feed", "x", "tiktok"}


def test_youtube_key_activates_real_client(monkeypatch) -> None:
    monkeypatch.setenv(YOUTUBE_API_KEY_ENV, "test-key-not-real")
    monkeypatch.delenv(TRIAGE_FEED_URLS_ENV, raising=False)

    sources = make_fetch_sources()

    youtube = next(s for s in sources if s.platform == "youtube")
    assert isinstance(youtube, YouTubeFetchSource)
    # X/TikTok stay fakes regardless (no real client exists for them yet).
    assert isinstance(next(s for s in sources if s.platform == "x"), FakeFetchSource)
    assert isinstance(next(s for s in sources if s.platform == "tiktok"), FakeFetchSource)


def test_triage_feed_urls_activates_real_client(monkeypatch) -> None:
    monkeypatch.delenv(YOUTUBE_API_KEY_ENV, raising=False)
    monkeypatch.setenv(TRIAGE_FEED_URLS_ENV, "https://example.com/feed.xml")

    sources = make_fetch_sources()

    triage = next(s for s in sources if s.platform == "triage_feed")
    assert isinstance(triage, TriageFeedSource)
    assert isinstance(next(s for s in sources if s.platform == "youtube"), FakeFetchSource)


async def test_real_youtube_source_without_key_raises_typed_error(monkeypatch) -> None:
    # Constructing the real client directly (bypassing the factory) and
    # polling without the key must fail loudly with a typed error, never
    # silently degrade or make a keyless call.
    monkeypatch.delenv(YOUTUBE_API_KEY_ENV, raising=False)

    source = YouTubeFetchSource()

    with pytest.raises(FetchSourceError):
        await source.poll(limit=5)
