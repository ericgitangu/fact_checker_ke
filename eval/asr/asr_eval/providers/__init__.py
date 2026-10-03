from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class TranscriptResult:
    clip_id: str
    ok: bool
    transcript: str = ""
    latency_s: float = 0.0
    est_cost_usd: float = 0.0
    error: str = ""


class AsrProvider(Protocol):
    name: str
    endpoint: str
    terms_class: str  # e.g. "Vertex AI paid (Cloud terms, no-train)"

    def transcribe(self, wav_path: str, duration_s: float) -> TranscriptResult: ...
