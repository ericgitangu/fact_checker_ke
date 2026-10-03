"""Transcriber Protocol: structural typing boundary for speech-to-text.

Only a fake implementation exists in this skeleton (no real STT vendor
call, no API keys). A real implementation (e.g. wrapping Whisper or a
managed STT API) can be swapped in later without touching call sites,
since callers depend on this Protocol, not a concrete class.
"""

from __future__ import annotations

from typing import Protocol


class TranscriptionResult:
    __slots__ = ("duration_seconds", "language", "text")

    def __init__(self, text: str, language: str, duration_seconds: float) -> None:
        self.text = text
        self.language = language
        self.duration_seconds = duration_seconds


class Transcriber(Protocol):
    async def transcribe(self, audio_url: str) -> TranscriptionResult:
        """Transcribe audio at `audio_url` and return the result.

        Implementations must raise `TranscriptionError` (not a bare
        exception) on failure so callers can distinguish expected failure
        modes (unsupported format, unreachable url) from bugs.
        """
        ...


class TranscriptionError(Exception):
    """Raised by Transcriber implementations for expected failure modes."""
