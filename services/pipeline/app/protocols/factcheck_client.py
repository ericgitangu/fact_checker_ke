"""FactCheckClient Protocol: Google Fact Check Tools API (`claims:search`)
boundary, and the 24h-cache Protocol that sits in front of it (ADR-0004
step 4b; ADR-0018's 24h Fact-Check-API cache referenced by ADR-0023 §2).
"""

from __future__ import annotations

from typing import Protocol


class FactCheckResult:
    __slots__ = ("doc_id", "publisher", "review_date", "text", "url")

    def __init__(
        self, *, doc_id: str, text: str, publisher: str, url: str, review_date: str | None
    ) -> None:
        self.doc_id = doc_id
        self.text = text
        self.publisher = publisher
        self.url = url
        self.review_date = review_date


class FactCheckClientError(Exception):
    """Raised for expected failure modes (timeout, non-2xx, malformed
    response). Never raised for "no results" — that's an empty list."""


class FactCheckClient(Protocol):
    async def search(
        self,
        query: str,
        *,
        language_code: str = "en",
        review_publisher_site_filter: str | None = None,
    ) -> list[FactCheckResult]:
        """`claims:search` against the Fact Check Tools API (or a cached/
        fake equivalent). Must raise FactCheckClientError on expected
        failure modes."""
        ...


class FactCheckCache(Protocol):
    """24h TTL cache in front of FactCheckClient.search. A real deployment
    may back this with Upstash Redis; this skeleton only needs an
    in-memory Protocol implementation (see app/clients/factcheck_api.py)."""

    def get(self, key: str) -> list[FactCheckResult] | None: ...

    def set(self, key: str, value: list[FactCheckResult], *, ttl_seconds: int = 86400) -> None: ...
