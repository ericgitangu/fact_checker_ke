"""ADR-0032/0005 STT compliance gate — source-agnostic (extracted from
fetch_hop so BOTH the fetch engine and, per ADR-0038, the submission analyze
path can share ONE fail-closed ladder).

The compliance fence lives HERE, in a single place, so it cannot drift between
callers: third-party audio is NEVER transcribed. A caller that gets None must
stop WITHOUT calling the transcriber or the LLM — never fabricate a transcript.
"""

from __future__ import annotations

from app.protocols.transcriber import Transcriber, TranscriptionError


async def resolve_claim_text(
    *,
    text: str,
    audio_url: str | None,
    stt_eligible: bool,
    transcriber: Transcriber | None,
) -> str | None:
    """Return the claim-bearing text, or None when blocked.

    - `text` present -> used as-is, no STT call (unchanged for every existing
      fetch source).
    - `text` empty AND `audio_url` set:
        - NOT `stt_eligible` -> None (fail-closed: audio exists but this item is
          not in the lawful owner-authorized/partner/open-licensed/live-capture
          subset — never download/transcribe third-party audio).
        - no `transcriber` wired -> None (the compliant-subset allowance never
          implies a transcriber must be called if one wasn't configured).
        - else -> transcribe; fail-closed to None on TranscriptionError.
    """
    if text.strip():
        return text
    if not audio_url:
        return None
    if not stt_eligible:
        return None
    if transcriber is None:
        return None
    try:
        transcription = await transcriber.transcribe(audio_url)
    except TranscriptionError:
        return None
    return transcription.text
