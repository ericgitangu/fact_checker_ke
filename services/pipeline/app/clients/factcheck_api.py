"""Google Fact Check Tools API client (`claims:search`), httpx-based, with a
24h in-memory cache Protocol implementation in front of it.

AT-0005-3 / ADR-0005 §"Free-tier terms: verified, and prohibitive": this
client must never call an unpaid/AI-Studio endpoint. The Fact Check Tools
API (`factchecktools.googleapis.com`) is a distinct, API-key-gated Google
API — not the unpaid Gemini/AI-Studio host named once, canonically, in
app/config.py:FORBIDDEN_UNPAID_HOST (deliberately not re-typed here, so the
static grep backstop in scripts/at/at-0005.sh has exactly one legitimate
occurrence to allow-list, never a second place that could silently drift).
We assert the host explicitly below so a future edit can't silently
repoint this at the wrong host.
"""

from __future__ import annotations

import os
import time

import httpx

from app.config import FORBIDDEN_UNPAID_HOST
from app.protocols.factcheck_client import FactCheckClientError, FactCheckResult

_FACTCHECK_API_HOST = "factchecktools.googleapis.com"
_BASE_URL = f"https://{_FACTCHECK_API_HOST}/v1alpha1/claims:search"

assert FORBIDDEN_UNPAID_HOST not in _BASE_URL  # config assertion, AT-0005-3


class InMemoryFactCheckCache:
    """24h TTL cache, in-memory only. Swap for Upstash Redis before real
    deployment (tracked as tech debt alongside idempotency.py's note)."""

    def __init__(self) -> None:
        self._entries: dict[str, tuple[float, list[FactCheckResult]]] = {}

    def get(self, key: str) -> list[FactCheckResult] | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._entries[key]
            return None
        return value

    def set(self, key: str, value: list[FactCheckResult], *, ttl_seconds: int = 86400) -> None:
        self._entries[key] = (time.monotonic() + ttl_seconds, value)


def _cache_key(query: str, language_code: str, review_publisher_site_filter: str | None) -> str:
    return f"{language_code}:{review_publisher_site_filter or ''}:{query}"


class GoogleFactCheckClient:
    """Real client. Requires GOOGLE_FACTCHECK_API_KEY; raises
    FactCheckClientError (not at construction, but on first use without a
    key) so a missing key degrades to "no results from this source" in a
    caller that catches the typed error, rather than crashing hop startup.
    """

    def __init__(self, *, cache: InMemoryFactCheckCache | None = None, timeout_seconds: float = 10.0) -> None:
        self._cache = cache or InMemoryFactCheckCache()
        self._timeout = timeout_seconds

    async def search(
        self,
        query: str,
        *,
        language_code: str = "en",
        review_publisher_site_filter: str | None = None,
    ) -> list[FactCheckResult]:
        api_key = os.environ.get("GOOGLE_FACTCHECK_API_KEY")
        if not api_key:
            raise FactCheckClientError(
                "GOOGLE_FACTCHECK_API_KEY is not set; use FakeFactCheckClient in dev/test"
            )
        key = _cache_key(query, language_code, review_publisher_site_filter)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        params: dict[str, str] = {"query": query, "key": api_key, "languageCode": language_code}
        if review_publisher_site_filter:
            params["reviewPublisherSiteFilter"] = review_publisher_site_filter

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(_BASE_URL, params=params)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise FactCheckClientError(f"Fact Check Tools API request failed: {exc}") from exc
        except ValueError as exc:  # json decode error
            raise FactCheckClientError(f"Fact Check Tools API returned invalid JSON: {exc}") from exc

        results: list[FactCheckResult] = []
        for i, claim in enumerate(payload.get("claims", [])):
            for review in claim.get("claimReview", []):
                # Include the fact-checker's VERDICT (textualRating) and
                # review headline, not just the claim text. Without the
                # verdict the draft-verdict LLM only sees "a claim someone
                # examined" and can't conclude -> every check stays Unproven
                # even when a credible fact-check exists (confirmed live
                # 2026-10-05). textualRating is the fact-checker's own rating
                # string (e.g. "False", "Misleading"); the model still makes
                # its own call, citation-integrity-checked against this text.
                claim_text = claim.get("text", "")
                verdict = review.get("textualRating") or "(no explicit rating given)"
                review_title = review.get("title", "")
                combined = f"Claim examined: {claim_text}\nFact-checker's rating: {verdict}"
                if review_title:
                    combined += f"\nReview: {review_title}"
                results.append(
                    FactCheckResult(
                        doc_id=f"factcheck:{query[:20]}:{i}:{review.get('url', '')}",
                        text=combined,
                        publisher=review.get("publisher", {}).get("name", "unknown"),
                        url=review.get("url", ""),
                        review_date=review.get("reviewDate"),
                    )
                )
        self._cache.set(key, results)
        return results


class FakeFactCheckClient:
    """Deterministic fake: never calls a real vendor. Returns a fixed,
    keyword-driven result set so tests exercise the retrieve/citation-guard
    path without network access."""

    def __init__(self) -> None:
        self._cache = InMemoryFactCheckCache()

    async def search(
        self,
        query: str,
        *,
        language_code: str = "en",
        review_publisher_site_filter: str | None = None,
    ) -> list[FactCheckResult]:
        key = _cache_key(query, language_code, review_publisher_site_filter)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        results = [
            FactCheckResult(
                doc_id="factcheck:fake:0",
                text=f"[fake fact-check result for query: {query[:50]}]",
                publisher="PesaCheck (fake fixture)",
                url="https://pesacheck.org/fake-fixture",
                review_date="2026-01-01",
            )
        ]
        self._cache.set(key, results)
        return results


def make_factcheck_client() -> GoogleFactCheckClient | FakeFactCheckClient:
    """Selection by env, mirroring the LLM client factory: a real key picks
    the real client, otherwise the deterministic fake."""
    if os.environ.get("GOOGLE_FACTCHECK_API_KEY"):
        return GoogleFactCheckClient()
    return FakeFactCheckClient()
