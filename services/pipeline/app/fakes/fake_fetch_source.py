"""Deterministic FetchSource fakes: never make an outbound call.

One reusable fake class, instantiated per platform with a fixed fixture
list (so test code building an AT-0032-2/3 scenario — "candidate below
tau", "same claim on two platforms" — just constructs the fixtures it
needs rather than hand-rolling a new fake per test). `poll()` returns a
rotating/sliced view of the fixture list so repeated polls (simulating
multiple cron ticks) can be exercised without a second fixture set.
"""

from __future__ import annotations

from app.protocols.fetch_source import FetchCandidate


class FakeFetchSource:
    """Never calls a real vendor. `fixtures` is the full candidate set
    this source "knows about"; `poll` returns up to `limit` of them,
    in order, every call (idempotent across polls — a real source would
    naturally return the same still-trending item on back-to-back
    polls, which is exactly the case the dedup layer must collapse)."""

    def __init__(self, *, platform: str, fixtures: list[FetchCandidate] | None = None) -> None:
        self._platform = platform
        self.fixtures = fixtures or []
        self.poll_count = 0

    @property
    def platform(self) -> str:
        return self._platform

    async def poll(self, *, limit: int = 20) -> list[FetchCandidate]:
        self.poll_count += 1
        return list(self.fixtures[:limit])


__all__ = ["FakeFetchSource"]
