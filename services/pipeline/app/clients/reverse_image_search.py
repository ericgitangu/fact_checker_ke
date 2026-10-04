"""Real ReverseImageSearch implementation, mirroring llm_anthropic.py's /
youtube_fetch_source.py's pattern: lazily imports/constructs, requires
REVERSE_IMAGE_API_KEY to be set (only `find_earlier_copy` checks for it,
never module import or `__init__`), and raises the typed
ReverseImageSearchError (never a bare exception) on an expected failure
mode.

NO reverse-image vendor is actually contracted yet (ADR-0006 §"Signal #3"
/ ADR-0032 AT-0032-8 both flag this as a Protocol stub with no vendor
wired). This class exists so `app.clients.reverse_image_factory`'s "real
branch" is reachable and independently testable (activation-on-key,
zero-outbound-without-key) -- per this change's task brief, which asks
for a real client gated on a key, not merely another fake. The exact
vendor contract is genuinely undetermined:

  TECH DEBT (flagged, not hidden): the request/response shape below is a
  generic placeholder (`POST {REVERSE_IMAGE_API_URL} {"media_hash": ...}`
  -> `{"found": bool, "source_url": str, "found_at": str}`) that does NOT
  correspond to any contracted vendor (candidates per ADR-0006's own
  text: Google Lens / Vision Web Detection, TinEye). Whoever wires a real
  vendor must replace this module's request/response handling to match
  that vendor's actual API -- this class's only durable contribution is
  the activation/error-handling scaffold (key-gating, typed errors,
  lazy httpx construction), not the wire format.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.protocols.reverse_image import (
    EarlierCopyMatch,
    ReverseImageSearch,
    ReverseImageSearchError,
)

REVERSE_IMAGE_API_KEY_ENV = "REVERSE_IMAGE_API_KEY"
REVERSE_IMAGE_API_URL_ENV = "REVERSE_IMAGE_API_URL"
# Placeholder-only: no real vendor endpoint is contracted (see module
# docstring). `.invalid` (RFC 2606) so a misconfigured deployment that
# somehow reaches this code path fails DNS resolution immediately rather
# than silently hitting an unintended real host.
_DEFAULT_API_URL = "https://reverse-image-search.invalid/v1/lookup"


class RealReverseImageSearch(ReverseImageSearch):
    """Activates only when REVERSE_IMAGE_API_KEY is set (see
    app/clients/reverse_image_factory.py). Importing this module and
    constructing this class make no network call -- only
    `find_earlier_copy` does, and only after confirming the key is
    present."""

    def __init__(self, *, timeout_seconds: float = 10.0) -> None:
        self._timeout = timeout_seconds

    def find_earlier_copy(self, media_hash: str) -> EarlierCopyMatch | None:
        api_key = os.environ.get(REVERSE_IMAGE_API_KEY_ENV)
        if not api_key:
            raise ReverseImageSearchError(
                f"{REVERSE_IMAGE_API_KEY_ENV} is not set; use FakeReverseImageSearch in dev/test"
            )
        api_url = os.environ.get(REVERSE_IMAGE_API_URL_ENV, _DEFAULT_API_URL)

        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(
                    api_url,
                    json={"media_hash": media_hash},
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                response.raise_for_status()
                payload: dict[str, Any] = response.json()
        except httpx.HTTPError as exc:
            raise ReverseImageSearchError(f"reverse-image search request failed: {exc}") from exc
        except ValueError as exc:  # json decode error
            raise ReverseImageSearchError(f"reverse-image search returned invalid JSON: {exc}") from exc

        if not payload.get("found"):
            return None
        source_url = payload.get("source_url")
        found_at = payload.get("found_at")
        if not isinstance(source_url, str) or not isinstance(found_at, str):
            raise ReverseImageSearchError(
                "reverse-image search returned found=true without a valid source_url/found_at"
            )
        return EarlierCopyMatch(source_url=source_url, found_at=found_at)


__all__ = ["REVERSE_IMAGE_API_KEY_ENV", "REVERSE_IMAGE_API_URL_ENV", "RealReverseImageSearch"]
