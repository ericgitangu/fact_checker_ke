"""Content-hash keyed idempotency store.

In-memory only, per ADR-0009's event flow (each stage is keyed by a content
hash so a QStash retry does not redo work). Swap for Upstash Redis before
any real deployment — tracked as tech debt, not silently buried.
"""

from __future__ import annotations

import hashlib
from typing import Any


def content_hash(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class InMemoryIdempotencyStore:
    def __init__(self) -> None:
        self._results: dict[str, Any] = {}

    def get(self, key: str) -> Any | None:
        return self._results.get(key)

    def set(self, key: str, value: Any) -> None:
        self._results[key] = value
