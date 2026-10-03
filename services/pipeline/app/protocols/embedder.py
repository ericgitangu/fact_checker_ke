"""Embedder Protocol: structural typing boundary for claim embedding.

ADR-0009's roadmap earmarks a Rust service as a later swap-in for
performance-sensitive stages. Depending on this Protocol (not a concrete
class) in call sites means that swap requires no change here — only a new
Protocol implementation (e.g. a gRPC client to the Rust service) and a
wiring change in app/stages/verify.py's client selection.
"""

from __future__ import annotations

from typing import Protocol

EMBEDDING_DIM = 384


class EmbeddingError(Exception):
    """Raised by Embedder implementations for expected failure modes
    (model not loaded, input too long, backend unavailable)."""


class Embedder(Protocol):
    @property
    def dimensions(self) -> int:
        """Vector length produced by `embed`. Must equal EMBEDDING_DIM (384)
        for the pgvector column this feeds at integration time."""
        ...

    def embed(self, text: str) -> list[float]:
        """Return a dense embedding for `text`.

        Must raise EmbeddingError (not a bare exception) on an expected
        failure mode.
        """
        ...
