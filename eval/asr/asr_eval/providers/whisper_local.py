"""faster-whisper large-v3 (CPU/MPS) reference anchor — OPTIONAL per the
task brief.

Decision recorded at harness-build time: SKIPPED for Round A. Reason: a
large-v3 CPU run over 30 clips plus the ~3GB one-time model download risked
blowing the time budget for this round, and ADR-0005 already holds a
published FLEURS sw_ke Whisper large-v3 number (31.0-32.4% WER, MIT licence,
cited `[V]` in the ADR's original evidence table) to anchor against. Round B
can add a locally-run anchor if the published number is ever disputed.
"""
from __future__ import annotations

from . import TranscriptResult

SKIPPED_REASON = (
    "Round A scope cut: faster-whisper large-v3 CPU run (plus ~3GB model "
    "download) skipped to stay inside the time budget; ADR-0005 already "
    "holds a published FLEURS sw_ke Whisper large-v3 anchor (31.0-32.4% "
    "WER [V]) for comparison."
)


class WhisperLocalProvider:
    name = "whisper-large-v3-local"
    endpoint = "SKIPPED (not run this round)"
    terms_class = "n/a — not invoked"

    def transcribe(self, wav_path: str, duration_s: float) -> TranscriptResult:
        clip_id = wav_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        return TranscriptResult(clip_id=clip_id, ok=False, error=SKIPPED_REASON)
