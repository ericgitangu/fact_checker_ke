"""FetchSource Protocol: structural typing boundary for the autonomous
fetch engine's per-platform discovery clients (ADR-0032).

ADR-0032's non-negotiable boundary: owner keys grant *discovery and
metadata*, never the right to download/isolate third-party audio or
video (ADR-0002 blockers #5/#8). A FetchSource therefore returns only
metadata/text the platform's official API legitimately exposes — never
media bytes. `text` is the best-effort claim-bearing text available
(title + description + caption-if-lawfully-returned); it is never a
transcript fabricated by this codebase.

Real implementations (YouTube Data API v3 PRIMARY, PesaCheck/Africa
Check RSS triage) activate only when their env var is present
(app/clients/fetch_source_factory.py:make_fetch_sources) and are never
constructed otherwise — see that module for the "activate on owner's
keys, fall back to fakes" selection, and tests/test_fetch_sources.py's
AT-0032-1 for the zero-outbound-call proof.

X and TikTok are intentionally protocol+fake stubs only in this slice
(ADR-0032 §"Per-platform feasibility": X is metered/pay-per-use and
TikTok has no autonomous-discovery path) — a real client for either is
deferred, not built here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


class FetchSourceError(Exception):
    """Raised by FetchSource implementations for expected failure modes
    (HTTP error, rate limit, malformed response, missing credential)."""


@dataclass(frozen=True, slots=True)
class FetchCandidate:
    """One item observed from a platform poll. `text` is the
    claim-bearing text available for the cheap claim-density pre-filter
    and, if the candidate survives scoring+dedup, for the analyze hop —
    never a transcript of third-party audio/video (ADR-0032 compliance
    boundary)."""

    platform: str
    native_id: str
    title: str
    text: str
    url: str
    observed_at: datetime
    # Raw counts at observation time (views/likes/reposts/comments,
    # whatever the platform exposes) — the scorer (app/stages/
    # fetch_scoring.py) derives *velocity* from the delta between
    # observations of the same (platform, native_id), not from this
    # absolute snapshot alone.
    engagement: dict[str, int] = field(default_factory=dict)
    # Best-effort content fingerprint for cross-platform/cross-post
    # identity (ADR-0032 §3 layer 2) — e.g. a hash of
    # title+duration+thumbnail where the platform exposes them. None
    # when the source has no such signal (the claim-text content hash
    # computed downstream, in the dedup store, still applies).
    fingerprint: str | None = None


class FetchSource(Protocol):
    @property
    def platform(self) -> str:
        """Platform identifier, e.g. "youtube", "pesacheck_triage", "x",
        "tiktok". Used as the dedup-store's platform-identity key."""
        ...

    async def poll(self, *, limit: int = 20) -> list[FetchCandidate]:
        """Return up to `limit` candidate items from this source's
        current allow-list/feed. Must raise FetchSourceError (not a bare
        exception) on an expected failure mode. Must make NO outbound
        call at all when the source's activating credential/config is
        absent — callers select a Fake* implementation in that case
        (app/clients/fetch_source_factory.py), this Protocol does not
        enforce it itself."""
        ...


__all__ = ["FetchCandidate", "FetchSource", "FetchSourceError"]
