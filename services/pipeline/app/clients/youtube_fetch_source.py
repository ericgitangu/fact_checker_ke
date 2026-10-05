"""Real FetchSource: YouTube Data API v3 (ADR-0032 PRIMARY discovery
source). Activates only when YOUTUBE_API_KEY is set — see
app/clients/fetch_source_factory.py. Importing this module never makes
a network call or requires the key; only `poll()` does.

Compliance boundary (ADR-0032 / ADR-0002 blockers #5/#8): this client
calls `search.list` + `videos.list` only — metadata (title, description,
view/like/comment counts). It never calls `captions.download` and never
downloads audio/video bytes. `FetchCandidate.text` is built from
title+description only, never a transcript.

Quota: `search.list` costs 100 units, `videos.list` costs 1 unit, against
a 10,000 units/day free quota (ADR-0032 feasibility table) — a single
`poll()` call costs at most 100 + len(results) units. Cadence (how often
`poll()` is invoked) is the caller's concern (QStash cron, out of scope
here); this client does not self-throttle beyond the per-call quota cost
it documents.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.protocols.fetch_source import FetchCandidate, FetchSourceError

YOUTUBE_API_KEY_ENV = "YOUTUBE_API_KEY"
_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"

# ADR-0032 Appendix A seed list (2026-10-04 KE-landscape research):
# monitoring seeds, not an endorsement of any creator's content. Data,
# not a constant baked deep in logic — overridable via
# YOUTUBE_FETCH_QUERY for tuning without a code change.
_DEFAULT_QUERY = "Kenya politics Ruto maandamano"


def _env_query() -> str:
    return os.environ.get("YOUTUBE_FETCH_QUERY", _DEFAULT_QUERY)


# ADR-0032: the fetch engine surfaces CURRENTLY-trending claims, so only
# pull videos published within a recent rolling window (default 7 days,
# tunable via YOUTUBE_PUBLISHED_AFTER_DAYS) -- without this, YouTube's
# order=date search still backfills older videos when recent matches are
# sparse, which stales the feed. Returned as an RFC3339 "Z" timestamp,
# the format YouTube's search.list publishedAfter parameter requires.
_DEFAULT_PUBLISHED_AFTER_DAYS = 7


def _published_after() -> str:
    try:
        days = int(os.environ.get("YOUTUBE_PUBLISHED_AFTER_DAYS", _DEFAULT_PUBLISHED_AFTER_DAYS))
    except ValueError:
        days = _DEFAULT_PUBLISHED_AFTER_DAYS
    cutoff = datetime.now(UTC) - timedelta(days=max(days, 1))
    return cutoff.isoformat(timespec="seconds").replace("+00:00", "Z")


class YouTubeFetchSource:
    """Real client. Requires YOUTUBE_API_KEY; raises FetchSourceError on
    first use without one (mirrors GoogleFactCheckClient's pattern) so a
    missing key degrades to "no candidates from this source" in a caller
    that handles the typed error, rather than crashing at construction."""

    def __init__(self, *, timeout_seconds: float = 10.0) -> None:
        self._timeout = timeout_seconds

    @property
    def platform(self) -> str:
        return "youtube"

    async def poll(self, *, limit: int = 20) -> list[FetchCandidate]:
        api_key = os.environ.get(YOUTUBE_API_KEY_ENV)
        if not api_key:
            raise FetchSourceError(
                "YOUTUBE_API_KEY is not set; use FakeFetchSource in dev/test"
            )

        search_params = {
            "part": "snippet",
            "q": _env_query(),
            "type": "video",
            "order": "date",
            "publishedAfter": _published_after(),
            "maxResults": str(min(limit, 50)),
            "regionCode": "KE",
            "key": api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                search_resp = await client.get(_SEARCH_URL, params=search_params)
                search_resp.raise_for_status()
                search_payload = search_resp.json()

                video_ids = [
                    item["id"]["videoId"]
                    for item in search_payload.get("items", [])
                    if item.get("id", {}).get("videoId")
                ]
                if not video_ids:
                    return []

                videos_resp = await client.get(
                    _VIDEOS_URL,
                    params={
                        "part": "snippet,statistics",
                        "id": ",".join(video_ids),
                        "key": api_key,
                    },
                )
                videos_resp.raise_for_status()
                videos_payload = videos_resp.json()
        except httpx.HTTPError as exc:
            raise FetchSourceError(f"YouTube Data API request failed: {exc}") from exc
        except ValueError as exc:  # json decode error
            raise FetchSourceError(f"YouTube Data API returned invalid JSON: {exc}") from exc

        return [_to_candidate(item) for item in videos_payload.get("items", [])]


def _to_candidate(item: dict[str, Any]) -> FetchCandidate:
    snippet = item.get("snippet", {})
    stats = item.get("statistics", {})
    title = snippet.get("title", "")
    description = snippet.get("description", "")
    return FetchCandidate(
        platform="youtube",
        native_id=item["id"],
        title=title,
        text=f"{title}\n{description}".strip(),
        url=f"https://www.youtube.com/watch?v={item['id']}",
        observed_at=datetime.now(UTC),
        engagement={
            "views": int(stats.get("viewCount", 0) or 0),
            "likes": int(stats.get("likeCount", 0) or 0),
            "comments": int(stats.get("commentCount", 0) or 0),
        },
    )


__all__ = ["YOUTUBE_API_KEY_ENV", "YouTubeFetchSource"]
