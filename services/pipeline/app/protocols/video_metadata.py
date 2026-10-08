"""ADR-0038 enrichment: a lawful video-metadata fetcher.

A bare video-URL submission with no user quote is checkable from the uploader's
PUBLISHED METADATA (title + description, via the platform's data API) — which is
NOT a transcript and never downloads audio/video bytes, so the ADR-0002/0004 #6
"never transcribe third-party media" fence is untouched. The metadata is the
uploader's framing (attribution: unverified), handed to the normal analyze ->
verify path so the relevance/recency guard gates any verdict.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class VideoMetadata:
    """Lawful, publisher-provided metadata for a video URL — NOT a transcript."""

    resolved_url: str
    title: str
    description: str
    published_at: str | None  # ISO8601 from the platform, or None if absent
    channel: str | None = None


class VideoMetadataFetcher(Protocol):
    """Fetches publisher metadata for a video URL. Returns None when the URL
    isn't a recognised video, the item is unavailable, or the (metadata-only)
    API call fails — the caller then falls back to needs_quote. Implementations
    MUST only call metadata endpoints (never captions/audio)."""

    async def fetch_metadata(self, url: str) -> VideoMetadata | None: ...
