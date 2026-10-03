"""CheckStore Protocol: structural typing boundary for prior-check retrieval.

The real Postgres (Neon) read lands at wave-2 integration — packages/db is
out of scope for this change (file-ownership boundary). This Protocol lets
app/stages/verify.py depend on an abstraction today; only a new
implementation (PostgresCheckStore) and a wiring change are needed later.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from app.models.enums import Rating


class StoredCheck:
    """A previously-verified claim available for dedup/reuse."""

    __slots__ = (
        "check_id",
        "claim_text",
        "dates",
        "embedding",
        "entities",
        "negation_present",
        "numbers",
        "rating",
        "valid_as_of",
    )

    def __init__(
        self,
        *,
        check_id: str,
        claim_text: str,
        embedding: list[float],
        rating: Rating | None,
        valid_as_of: date,
        numbers: frozenset[str],
        dates: frozenset[str],
        entities: frozenset[str],
        negation_present: bool,
    ) -> None:
        self.check_id = check_id
        self.claim_text = claim_text
        self.embedding = embedding
        self.rating = rating
        self.valid_as_of = valid_as_of
        self.numbers = numbers
        self.dates = dates
        self.entities = entities
        self.negation_present = negation_present


class CheckStore(Protocol):
    def find_candidates(
        self, embedding: list[float], *, limit: int = 5
    ) -> list[tuple[float, StoredCheck]]:
        """Return up to `limit` (cosine_similarity, stored_check) pairs,
        most similar first. Similarity is returned alongside the check
        (rather than requiring a second lookup) so the dedup guard
        (app/stages/dedup_guard.py) can apply its tau threshold without a
        second round-trip to the store."""
        ...

    def save(self, check: StoredCheck) -> None:
        """Persist a new check for future dedup/reuse lookups."""
        ...
