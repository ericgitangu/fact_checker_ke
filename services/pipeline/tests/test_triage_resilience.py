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


# --- Google News RSS shape (ADR-0037 follow-up: Cloudflare blocks PesaCheck's
# own feed from the GCP egress IP; Google News search feeds are served to
# datacenter IPs and surface the same KE fact-check items). Real sample below is
# trimmed from a live https://news.google.com/rss/search?... response. ---
_GOOGLE_NEWS_RSS = (
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
    "<title>Kenya fact check - Google News</title>"
    "<item>"
    "<title>Images of Nigerian estate falsely shared as Kenya's affordable "
    "housing project - AFP Fact Check</title>"
    "<link>https://news.google.com/rss/articles/CBMiYEFVX3lxb3B?oc=5</link>"
    '<guid isPermaLink="false">CBMiYEFVX3lxb3B</guid>'
    "<pubDate>Wed, 01 Oct 2026 08:00:00 GMT</pubDate>"
    '<description>&lt;a href="https://news.google.com/rss/articles/CBMiYEFVX3lxb3B?oc=5"&gt;'
    "Images of Nigerian estate falsely shared as Kenya's affordable housing project"
    '&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;AFP Fact Check&lt;/font&gt;</description>'
    '<source url="https://factcheck.afp.com">AFP Fact Check</source>'
    "</item>"
    "</channel></rss>"
)


async def test_google_news_shape_strips_publisher_suffix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRIAGE_FEED_URLS", "https://news.google.com/rss/search?q=x")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=_GOOGLE_NEWS_RSS)

    _patch(monkeypatch, handler)
    cands = await TriageFeedSource().poll(limit=10)
    assert len(cands) == 1
    c = cands[0]
    # " - AFP Fact Check" (== <source> text) is stripped from the title...
    assert c.title == "Images of Nigerian estate falsely shared as Kenya's affordable housing project"
    assert "AFP Fact Check" not in c.title
    # ...and the HTML-anchor description (which only echoes the headline) does not
    # get folded in as duplicate claim text.
    assert c.text == c.title
    assert "<a" not in c.text and "&nbsp;" not in c.text and "&amp;" not in c.text
    # opaque Google redirect link + guid preserved as-is (verify-hop resolves it).
    assert c.url == "https://news.google.com/rss/articles/CBMiYEFVX3lxb3B?oc=5"
    assert c.native_id == "CBMiYEFVX3lxb3B"


async def test_pesacheck_shape_still_parses_description(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No <source> element and a real prose <description> => classic PesaCheck
    # parsing path must be unchanged (additive-change regression guard).
    pesacheck = (
        '<?xml version="1.0"?><rss version="2.0"><channel>'
        "<item><title>FALSE: These pictures are not from Kisumu, Kenya</title>"
        "<link>https://pesacheck.org/false-kisumu</link><guid>pc1</guid>"
        "<pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>"
        "<description>A viral post claims the images show Kisumu flooding; they "
        "are from elsewhere.</description></item>"
        "</channel></rss>"
    )
    monkeypatch.setenv("TRIAGE_FEED_URLS", "https://pesacheck.org/tag/kenya/feed")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=pesacheck)

    _patch(monkeypatch, handler)
    cands = await TriageFeedSource().poll(limit=10)
    assert len(cands) == 1
    c = cands[0]
    assert c.title == "FALSE: These pictures are not from Kisumu, Kenya"
    assert c.text == f"{c.title}\nA viral post claims the images show Kisumu flooding; they are from elsewhere."
    assert c.url == "https://pesacheck.org/false-kisumu"
