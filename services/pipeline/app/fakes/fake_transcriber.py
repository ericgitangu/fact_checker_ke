from __future__ import annotations

from app.protocols.transcriber import Transcriber, TranscriptionError, TranscriptionResult


class FakeTranscriber(Transcriber):
    """Deterministic fake: never calls a real STT vendor. Returns a fixed
    transcript unless the url ends in `.unsupported`, which exercises the
    failure path in tests."""

    async def transcribe(self, audio_url: str) -> TranscriptionResult:
        if audio_url.endswith(".unsupported"):
            raise TranscriptionError(f"Unsupported audio format for url: {audio_url}")
        return TranscriptionResult(
            text="[fake transcript] this is a stubbed transcription for local dev",
            language="en",
            duration_seconds=12.5,
        )
