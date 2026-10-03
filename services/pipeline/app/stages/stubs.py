"""Idempotent stage stubs for normalize / transcribe / extract / retrieve / draft.

Each stage is a pure-ish function keyed by a content hash of its input: a
repeated call with the same input returns the same (cached) result rather
than redoing "work" — this is a stub today but establishes the idempotency
contract the real stages (and QStash retries) must honour.
"""

from __future__ import annotations

from typing import cast

from app.fakes.fake_llm_client import FakeLlmClient
from app.fakes.fake_transcriber import FakeTranscriber
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash

_store = InMemoryIdempotencyStore()
_transcriber = FakeTranscriber()
_llm = FakeLlmClient()


async def run_normalize(content: str) -> dict[str, str]:
    key = f"normalize:{content_hash(content)}"
    cached = _store.get(key)
    if cached is not None:
        # InMemoryIdempotencyStore.get is typed `Any | None` by design (it
        # is a generic cache keyed by string, agnostic to each stage's
        # result shape) — cast narrows back to this stage's own contract
        # rather than letting `Any` silently flow out (mypy strict
        # no-any-return), which is the 6 pre-existing errors this change
        # fixes across all 5 call sites in this module.
        return cast(dict[str, str], cached)
    result: dict[str, str] = {
        "normalized_text": content.strip().lower(),
        "content_hash": content_hash(content),
    }
    _store.set(key, result)
    return result


async def run_transcribe(audio_url: str) -> dict[str, str | float]:
    key = f"transcribe:{content_hash(audio_url)}"
    cached = _store.get(key)
    if cached is not None:
        return cast(dict[str, "str | float"], cached)
    transcription = await _transcriber.transcribe(audio_url)
    result: dict[str, str | float] = {
        "text": transcription.text,
        "language": transcription.language,
        "duration_seconds": transcription.duration_seconds,
    }
    _store.set(key, result)
    return result


async def run_extract(text: str) -> dict[str, list[str]]:
    key = f"extract:{content_hash(text)}"
    cached = _store.get(key)
    if cached is not None:
        return cast(dict[str, list[str]], cached)
    completion = await _llm.complete(f"Extract checkable claims from: {text}")
    result: dict[str, list[str]] = {"claims": [completion]}
    _store.set(key, result)
    return result


async def run_retrieve(claim_text: str) -> dict[str, list[str]]:
    key = f"retrieve:{content_hash(claim_text)}"
    cached = _store.get(key)
    if cached is not None:
        return cast(dict[str, list[str]], cached)
    result: dict[str, list[str]] = {"sources": []}
    _store.set(key, result)
    return result


async def run_draft(claim_text: str) -> dict[str, str]:
    key = f"draft:{content_hash(claim_text)}"
    cached = _store.get(key)
    if cached is not None:
        return cast(dict[str, str], cached)
    completion = await _llm.complete(f"Draft a verdict summary for: {claim_text}")
    result: dict[str, str] = {"summary": completion, "rating": "Unproven"}
    _store.set(key, result)
    return result
