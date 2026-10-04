"""FetchSource selection by env, mirroring make_llm_client /
make_factcheck_client / make_embedder: a real credential/config picks the
real client, otherwise a deterministic FakeFetchSource. Importing this
module makes no network call; only `poll()` on a constructed real client
does, and only YouTubeFetchSource/TriageFeedSource are ever constructed
with real network access — this factory never constructs them unless
their activating env var is present (AT-0032-1).

X and TikTok (ADR-0032 §"Per-platform feasibility"): X's free tier is
gone (metered, ~$0.005/read) and TikTok has no autonomous-discovery path
available to this project. Both stay protocol+fake stubs ONLY in this
slice — no real client exists to activate, by design, not by missing
code. A future wave adds a real, budgeted X client behind its own env
gate (ADR-0032 §4's per-read budget) and revisits TikTok only if a
research-API partnership lands.
"""

from __future__ import annotations

import os

from app.clients.triage_feed_source import TRIAGE_FEED_URLS_ENV, TriageFeedSource
from app.clients.youtube_fetch_source import YOUTUBE_API_KEY_ENV, YouTubeFetchSource
from app.fakes.fake_fetch_source import FakeFetchSource
from app.protocols.fetch_source import FetchSource


def make_fetch_sources() -> list[FetchSource]:
    """Returns the configured set of FetchSource instances: YouTube and
    the triage feed activate on their own env var; X and TikTok are
    always fakes in this slice (see module docstring)."""
    sources: list[FetchSource] = []

    if os.environ.get(YOUTUBE_API_KEY_ENV):
        sources.append(YouTubeFetchSource())
    else:
        sources.append(FakeFetchSource(platform="youtube"))

    if os.environ.get(TRIAGE_FEED_URLS_ENV):
        sources.append(TriageFeedSource())
    else:
        sources.append(FakeFetchSource(platform="triage_feed"))

    # X / TikTok: fake stubs only (see module docstring) — always a fake,
    # never a real client, regardless of any env var.
    sources.append(FakeFetchSource(platform="x"))
    sources.append(FakeFetchSource(platform="tiktok"))

    return sources


__all__ = ["make_fetch_sources"]
