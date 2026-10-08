"""Real FetchSource: PesaCheck/Africa Check RSS triage feed (ADR-0032
§"first-class triage feed"). A claim these outlets have already
debunked is both the highest-priority "going viral in KE" signal and an
authoritative check-against hit (ADR-0004 step 4) — this client only
*discovers* candidate items from the feed; attaching their debunk as
check-against evidence is verify-hop territory, out of scope here.

RSS feeds need no API key, so unlike YouTube/Anthropic this client's
"activation" gate is an explicit opt-in config var (TRIAGE_FEED_URLS,
comma-separated feed URLs) rather than a credential — same reasoning as
app/clients/embedder_factory.py's PIPELINE_USE_REAL_EMBEDDER flag:
"free" still means "makes a real outbound HTTP call", which AT-0032-1
requires to be zero when the engine is not explicitly configured to
reach the network.

Uses stdlib xml.etree.ElementTree (no feedparser dependency) — RSS 2.0's
subset used here (item/title/link/pubDate/guid) needs nothing heavier.
"""

from __future__ import annotations

import html
import logging
import os
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote
from xml.etree import ElementTree

import httpx

from app.protocols.fetch_source import FetchCandidate, FetchSourceError

TRIAGE_FEED_URLS_ENV = "TRIAGE_FEED_URLS"
# When set, fetch each feed THROUGH this proxy (a Vercel BFF route) instead of
# directly — so the request leaves Vercel's (non-blocked) egress rather than the
# Cloud Run egress IP that Cloudflare 403s on pesacheck.org (the egress-IP block;
# see reference-cloudrun-egress-ip-block). Called as `{proxy}?url=<encoded feed>`,
# the proxy returns the raw RSS. Unset -> direct fetch (dev/test, unchanged).
TRIAGE_FEED_PROXY_URL_ENV = "TRIAGE_FEED_PROXY_URL"

_log = logging.getLogger(__name__)


def _parse_pub_date(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(UTC)
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return datetime.now(UTC)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class TriageFeedSource:
    """Real client. Requires TRIAGE_FEED_URLS; raises FetchSourceError on
    first use without it. Polls every configured feed URL and merges
    items, newest-first, truncated to `limit`."""

    def __init__(self, *, timeout_seconds: float = 10.0) -> None:
        self._timeout = timeout_seconds

    @property
    def platform(self) -> str:
        return "triage_feed"

    async def poll(self, *, limit: int = 20) -> list[FetchCandidate]:
        raw_urls = os.environ.get(TRIAGE_FEED_URLS_ENV)
        if not raw_urls:
            raise FetchSourceError(
                "TRIAGE_FEED_URLS is not set; use FakeFetchSource in dev/test"
            )
        urls = [u.strip() for u in raw_urls.split(",") if u.strip()]

        # Per-feed resilience (verified need 2026-10-08: Africa Check's RSS 403s
        # behind Cloudflare server-side). A failing feed is logged and SKIPPED so
        # it can never zero the whole Kenyan feed; we raise only if EVERY
        # configured feed failed (so the caller logs "no candidates from this
        # source" rather than silently returning empty on a total outage).
        candidates: list[FetchCandidate] = []
        failures: list[str] = []
        # follow_redirects: PesaCheck's tag feeds 301 (e.g. /tagged/kenya/feed ->
        # /tag/kenya/feed); httpx does NOT follow by default, so without this the
        # redirect stub parses as invalid XML and the feed looks "failed".
        proxy = os.environ.get(TRIAGE_FEED_PROXY_URL_ENV)
        async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
            for url in urls:
                # Route through the Vercel BFF proxy when configured (Cloud Run's
                # egress IP is 403'd by Cloudflare on pesacheck.org); direct fetch
                # otherwise. The feed TEXT is returned either way, so parsing is
                # unchanged.
                fetch_url = f"{proxy.rstrip('/')}?url={quote(url, safe='')}" if proxy else url
                try:
                    response = await client.get(fetch_url)
                    response.raise_for_status()
                    candidates.extend(_parse_rss(response.text))
                except (httpx.HTTPError, ElementTree.ParseError) as exc:
                    _log.warning("triage feed skipped (%s): %s", url, exc)
                    failures.append(url)

        if failures and len(failures) == len(urls):
            raise FetchSourceError(
                f"all {len(urls)} triage RSS feed(s) failed; most recent: {failures[-1]}"
            )

        candidates.sort(key=lambda c: c.observed_at, reverse=True)
        return candidates[:limit]


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(raw: str) -> str:
    """De-HTML an RSS <description>. Google News ships the description as an
    anchor tag echoing the headline (`<a ...>Headline</a>&nbsp;<font>Publisher`),
    so strip tags + unescape entities before it reaches claim-text; PesaCheck's
    plain-prose descriptions pass through unchanged (no tags, nothing to strip)."""
    text = _HTML_TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _strip_publisher_suffix(title: str, source: str) -> str:
    """Google News appends ` - <publisher>` to every <title>, where <publisher>
    is exactly the <source> element text. Strip only that exact suffix (never a
    bare ` - ` split, which would maul headlines that legitimately contain one);
    PesaCheck/Africa Check items have no <source>, so `source` is empty and the
    title is returned untouched."""
    if source:
        suffix = f" - {source}"
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title


def _parse_rss(xml_text: str) -> list[FetchCandidate]:
    root = ElementTree.fromstring(xml_text)
    items: list[FetchCandidate] = []
    for item in root.iter("item"):
        raw_title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        source = (item.findtext("source") or "").strip()
        description = _strip_html((item.findtext("description") or "").strip())
        guid = (item.findtext("guid") or link or raw_title).strip()
        if not guid:
            continue

        title = _strip_publisher_suffix(raw_title, source)
        # Google News' de-HTML'd description just re-states the headline (+
        # publisher), so folding it in would duplicate the title. Only append a
        # description that adds genuinely new prose (PesaCheck's summary blurb).
        if description and description != title and title not in description:
            text = f"{title}\n{description}".strip()
        else:
            text = title
        items.append(
            FetchCandidate(
                platform="triage_feed",
                native_id=guid,
                title=title,
                text=text,
                # Google News links are opaque news.google.com/rss/articles/<b64>
                # redirects; stored as-is (resolving each would cost one HTTP
                # round-trip per item). poll()'s follow_redirects=True only
                # affects feed fetches, not these per-item links — verify-hop
                # resolves the real article URL downstream. For PesaCheck this is
                # already the canonical article URL.
                url=link,
                observed_at=_parse_pub_date(item.findtext("pubDate")),
            )
        )
    return items


__all__ = ["TRIAGE_FEED_URLS_ENV", "TriageFeedSource"]
