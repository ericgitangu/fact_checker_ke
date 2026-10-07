"""ADR-0037 YouTube discovery-driver: `trending` mode pulls YouTube's own
most-popular chart for Kenya (videos.list?chart=mostPopular&regionCode=KE) rather
than keyword search.list. Contract tests with an httpx MockTransport — no network.
"""

from __future__ import annotations

import httpx
import pytest

from app.clients.youtube_fetch_source import YouTubeFetchSource

_VIDEOS = {
    "items": [
        {
            "id": "abc123",
            "snippet": {"title": "Citizen TV Live", "description": "KE news"},
            "statistics": {"viewCount": "1000", "likeCount": "9", "commentCount": "3"},
        }
    ]
}


def _patch(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    orig = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda *a, **k: orig(*a, transport=httpx.MockTransport(handler), **k)
    )


async def test_trending_mode_uses_mostpopular_news(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOUTUBE_API_KEY", "k")
    monkeypatch.setenv("YOUTUBE_DISCOVERY_MODE", "trending")
    monkeypatch.delenv("YOUTUBE_TRENDING_CATEGORY_ID", raising=False)
    seen: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        return httpx.Response(200, json=_VIDEOS)

    _patch(monkeypatch, handler)
    cands = await YouTubeFetchSource().poll(limit=5)
    assert "/videos" in seen["url"] and "/search" not in seen["url"]  # 1 unit, not 100
    assert "chart=mostPopular" in seen["url"]
    assert "regionCode=KE" in seen["url"]
    assert "videoCategoryId=25" in seen["url"]  # News & Politics default
    assert len(cands) == 1 and cands[0].platform == "youtube"


async def test_trending_category_zero_omits_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOUTUBE_API_KEY", "k")
    monkeypatch.setenv("YOUTUBE_DISCOVERY_MODE", "trending")
    monkeypatch.setenv("YOUTUBE_TRENDING_CATEGORY_ID", "0")
    seen: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        return httpx.Response(200, json=_VIDEOS)

    _patch(monkeypatch, handler)
    await YouTubeFetchSource().poll(limit=5)
    assert "videoCategoryId" not in seen["url"]


async def test_default_mode_still_uses_search(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOUTUBE_API_KEY", "k")
    monkeypatch.delenv("YOUTUBE_DISCOVERY_MODE", raising=False)  # default = search
    urls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        urls.append(str(req.url))
        if "/search" in str(req.url):
            return httpx.Response(200, json={"items": [{"id": {"videoId": "v1"}}]})
        return httpx.Response(200, json=_VIDEOS)

    _patch(monkeypatch, handler)
    await YouTubeFetchSource().poll(limit=5)
    assert any("/search" in u for u in urls)  # keyword path preserved (not broken)
