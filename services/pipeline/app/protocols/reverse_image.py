"""ReverseImageSearch Protocol: structural typing boundary for ADR-0006
signal #3 ("reverse-image and keyframe search for earlier copies — often
the strongest real-world evidence").

No reverse-image search vendor (Google Lens API, TinEye, etc.) is wired —
this is a Protocol stub per the task brief ("Reverse-image/earlier-copy is
a Protocol stub"). The only implementation is
`app.fakes.fake_reverse_image.FakeReverseImageSearch`, which never performs
a network call and always returns "no earlier copy found" unless a test
fixture pre-seeds a match via `seed_match`.
"""

from __future__ import annotations

from typing import Protocol


class ReverseImageSearchError(Exception):
    """Raised by ReverseImageSearch implementations for expected failure
    modes (backend unavailable, quota exhausted)."""


class EarlierCopyMatch:
    __slots__ = ("found_at", "source_url")

    def __init__(self, *, source_url: str, found_at: str) -> None:
        self.source_url = source_url
        self.found_at = found_at  # ISO date string the earlier copy was first seen


class ReverseImageSearch(Protocol):
    def find_earlier_copy(self, media_hash: str) -> EarlierCopyMatch | None:
        """Return the earliest known prior copy of the media identified by
        `media_hash` (the content hash from app/stages/media_processing.py),
        or None if no earlier copy is known.

        Must raise ReverseImageSearchError (not a bare exception) on an
        expected failure mode.
        """
        ...
