from __future__ import annotations

from app.protocols.reverse_image import EarlierCopyMatch, ReverseImageSearch


class FakeReverseImageSearch(ReverseImageSearch):
    """Deterministic fake: never performs a network call. Returns None
    ("no earlier copy found") unless a test pre-seeds a match for a given
    media_hash via `seed_match`."""

    def __init__(self) -> None:
        self._seeded: dict[str, EarlierCopyMatch] = {}

    def seed_match(self, media_hash: str, match: EarlierCopyMatch) -> None:
        self._seeded[media_hash] = match

    def find_earlier_copy(self, media_hash: str) -> EarlierCopyMatch | None:
        return self._seeded.get(media_hash)
