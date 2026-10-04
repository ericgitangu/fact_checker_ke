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

import os
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

import httpx

from app.protocols.fetch_source import FetchCandidate, FetchSourceError

TRIAGE_FEED_URLS_ENV = "TRIAGE_FEED_URLS"


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

        candidates: list[FetchCandidate] = []
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                for url in urls:
                    response = await client.get(url)
                    response.raise_for_status()
                    candidates.extend(_parse_rss(response.text))
        except httpx.HTTPError as exc:
            raise FetchSourceError(f"triage RSS feed request failed: {exc}") from exc
        except ElementTree.ParseError as exc:
            raise FetchSourceError(f"triage RSS feed returned invalid XML: {exc}") from exc

        candidates.sort(key=lambda c: c.observed_at, reverse=True)
        return candidates[:limit]


def _parse_rss(xml_text: str) -> list[FetchCandidate]:
    root = ElementTree.fromstring(xml_text)
    items: list[FetchCandidate] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        description = (item.findtext("description") or "").strip()
        guid = (item.findtext("guid") or link or title).strip()
        if not guid:
            continue
        items.append(
            FetchCandidate(
                platform="triage_feed",
                native_id=guid,
                title=title,
                text=f"{title}\n{description}".strip(),
                url=link,
                observed_at=_parse_pub_date(item.findtext("pubDate")),
            )
        )
    return items


__all__ = ["TRIAGE_FEED_URLS_ENV", "TriageFeedSource"]
