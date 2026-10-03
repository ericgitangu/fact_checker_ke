"""Deterministic fake Embedder: never loads a real model or downloads
weights. Produces a stable 384-dim vector from a hash of the text so
semantically-similar-by-design test fixtures (e.g. two paraphrases built
from the same seed words) can assert cosine-similarity behaviour without
network access or a multi-hundred-MB model in the test environment.
"""

from __future__ import annotations

import hashlib
import math

from app.protocols.embedder import EMBEDDING_DIM, EmbeddingError


def _tokenize(text: str) -> list[str]:
    return [t for t in text.lower().replace(",", " ").replace(".", " ").split() if t]


class FakeEmbedder:
    @property
    def dimensions(self) -> int:
        return EMBEDDING_DIM

    def embed(self, text: str) -> list[float]:
        if not text.strip():
            raise EmbeddingError("cannot embed empty text")
        vector = [0.0] * EMBEDDING_DIM
        for token in _tokenize(text):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            for i in range(EMBEDDING_DIM):
                vector[i] += digest[i % len(digest)] / 255.0
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]
