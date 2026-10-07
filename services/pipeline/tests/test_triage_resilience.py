"""ADR-0037 triage-feed resilience: a single failing feed (verified: Africa Check
RSS 403s behind Cloudflare server-side) must be skipped, not zero the whole Kenyan
feed. Raise only when EVERY configured feed fails.
"""

from __future__ import annotations

import httpx
import pytest

from app.clients.triage_feed_source import TriageFeedSource
from app.protocols.fetch_source import FetchSourceError

_RSS = (
    '<?xml version="1.0"?><rss version="2.0"><channel>'
    "<item><title>KE claim</title><link>https://pesacheck.org/x</link>"
    "<guid>g1</guid><pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate></item>"
    "</channel></rss>"
)


def _patch(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    orig = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda *a, **k: orig(*a, transport=httpx.MockTransport(handler), **k)
    )


async def test_one_feed_fails_others_survive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAGE_FEED_URLS", "https://ok.test/feed,https://cloudflared.test/feed")

    def handler(req: httpx.Request) -> httpx.Response:
        if "cloudflared.test" in str(req.url):
            return httpx.Response(403, text="Just a moment...")  # Cloudflare challenge
        return httpx.Response(200, text=_RSS)

    _patch(monkeypatch, handler)
    cands = await TriageFeedSource().poll(limit=10)
    assert len(cands) == 1  # the good feed survived the bad one's 403
    assert cands[0].platform == "triage_feed"


async def test_all_feeds_fail_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRIAGE_FEED_URLS", "https://a.test/feed,https://b.test/feed")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="down")

    _patch(monkeypatch, handler)
    with pytest.raises(FetchSourceError):
        await TriageFeedSource().poll(limit=10)
