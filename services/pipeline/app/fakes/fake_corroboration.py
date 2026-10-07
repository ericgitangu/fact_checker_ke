"""Deterministic Corroboration fake: never performs a network call. Mirrors
FakeReverseImageSearch. By default raises nothing and returns an "inconclusive"
stance only when a test pre-seeds one via `seed_stance`; an unseeded claim
raises CorroborationError so the stage's fail-closed path (-> no_second_opinion)
is the default, keeping existing verify-hop tests a pure no-op."""

from __future__ import annotations

from app.protocols.corroboration import CorroborationError, Stance


class FakeCorroboration:
    def __init__(self) -> None:
        self._seeded: dict[str, tuple[Stance, list[str], float]] = {}

    def seed_stance(
        self, claim_text: str, stance: Stance, *, citations: list[str] | None = None, usd: float = 0.0
    ) -> None:
        self._seeded[claim_text] = (stance, citations or [], usd)

    async def assess(self, *, claim_text: str, language: str) -> tuple[Stance, list[str], float]:
        seeded = self._seeded.get(claim_text)
        if seeded is None:
            raise CorroborationError("FakeCorroboration: no seeded stance for this claim (default no-op).")
        return seeded


__all__ = ["FakeCorroboration"]
