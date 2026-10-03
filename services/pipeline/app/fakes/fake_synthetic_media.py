from __future__ import annotations

import hashlib

from app.protocols.synthetic_media import SyntheticMediaDetector, SyntheticMediaScore


class FakeSyntheticMediaDetector(SyntheticMediaDetector):
    """Deterministic local heuristic, never a vendor call.

    The "heuristic" is intentionally dumb and auditable: a stable hash of
    the bytes mapped into [0, 1]. This is enough to exercise the triage
    pipeline's score->label mapping end-to-end (including the "signals
    present, under review" mid-range band) without any ML model or vendor
    dependency. It is explicitly NOT a real detector and must never be
    presented as one — see app/protocols/synthetic_media.py's docstring.
    """

    def score(self, media_bytes: bytes, *, mime_type: str) -> SyntheticMediaScore:
        digest = hashlib.sha256(media_bytes).digest()
        raw = int.from_bytes(digest[:4], "big") / 2**32
        modality = "video" if mime_type.startswith("video/") else (
            "audio" if mime_type.startswith("audio/") else "image"
        )
        return SyntheticMediaScore(score=raw, modality=modality)
