"""SyntheticMediaDetector Protocol: structural typing boundary for
detector-score triage (ADR-0006 signal #4 — audio detectors gave the best
real-world AUC, but even the best commercial/fine-tuned detectors (0.79-0.93
AUC) fall well short of a confident "deepfake" classification).

HARD RULE (task brief + ADR-0006 round-2): no Reality Defender/Hive/vendor
keys, no billable calls. The only implementation wired by default is
`app.fakes.fake_synthetic_media.FakeSyntheticMediaDetector`, a deterministic
local heuristic (not a trained model, not a vendor call) — it exists so the
triage *pipeline shape* (score -> label, per the strict label rules below)
is exercised end-to-end today; a real commercial detector is a future swap
behind this same Protocol, never a hard dependency of this change.
"""

from __future__ import annotations

from typing import Protocol


class SyntheticMediaDetectionError(Exception):
    """Raised by SyntheticMediaDetector implementations for expected
    failure modes (corrupt bytes, unsupported mime type)."""


class SyntheticMediaScore:
    """Raw triage score. `score` in [0, 1]; higher = more signal of
    synthetic/manipulated origin. This is explicitly NOT a "deepfake
    probability" — ADR-0006 forbids treating a detector score alone as a
    confident classification (AT-0006)."""

    __slots__ = ("modality", "score")

    def __init__(self, *, score: float, modality: str) -> None:
        if not 0.0 <= score <= 1.0:
            raise ValueError(f"score must be in [0, 1], got {score!r}")
        self.score = score
        self.modality = modality  # "image" | "audio" | "video"


class SyntheticMediaDetector(Protocol):
    def score(self, media_bytes: bytes, *, mime_type: str) -> SyntheticMediaScore:
        """Return a triage score for `media_bytes`.

        Must raise SyntheticMediaDetectionError (not a bare exception) on an
        expected failure mode. Must NEVER itself emit the word "deepfake" —
        callers (app/stages/synthetic_media_triage.py) own label text and
        enforce the ADR-0006 label allowlist.
        """
        ...
