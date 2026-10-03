"""The `analyze` hop (POST /hops/analyze): normalize -> language-ID + claim
detection + inline EN working translation, in ONE structured Haiku-4.5-class
call (ADR-0005 ASR/translation amendments: language and translation emitted
by the same structured output as claim detection, no separate hop).

Idempotent on content hash (ADR-0017 §2's content-addressed result cache
layer) via the existing InMemoryIdempotencyStore.
"""

from __future__ import annotations

import json
import math

from pydantic import ValidationError

from app.models.hop_requests import AnalyzeHopRequest
from app.models.pipeline_io import AnalyzeResult, DetectedClaim, UsageRecord
from app.prompts.templates import build_analyze_prompt
from app.protocols.llm_client import LlmClient, LlmCompletionError
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash

# ADR-0004 AT-0004-E / ADR-0023 §5: at least 10% of dropped (non-checkable)
# items are sampled to editors so a misclassification doesn't silently drop
# a real claim.
_EDITOR_SAMPLE_RATE = 0.10


class AnalyzeHopError(Exception):
    """Raised when the analyze hop cannot produce a valid structured
    result after one retry (ADR-0023 §1: malformed/invalid-schema output is
    rejected and retried once, then routed to editor review rather than
    auto-processed)."""


def _parse_and_validate(raw: str) -> tuple[str, str, list[dict[str, str]]]:
    payload = json.loads(raw)  # raises json.JSONDecodeError on malformed JSON
    if not isinstance(payload, dict):
        raise TypeError("analyze completion is not a JSON object")
    language = payload["language"]
    translation_en = payload["translation_en"]
    claims = payload["claims"]
    if not isinstance(claims, list):
        raise TypeError("analyze completion 'claims' is not a list")
    return language, translation_en, claims


def _apply_editor_sampling(detected: list[DetectedClaim]) -> list[DetectedClaim]:
    dropped_indices = [i for i, c in enumerate(detected) if c.claim_type.value != "checkable"]
    if not dropped_indices:
        return detected
    sample_size = max(1, math.ceil(len(dropped_indices) * _EDITOR_SAMPLE_RATE))
    sampled = set(dropped_indices[:sample_size])
    return [
        c.model_copy(update={"sampled_for_editor_review": i in sampled}) if i in dropped_indices else c
        for i, c in enumerate(detected)
    ]


async def run_analyze_hop(
    request: AnalyzeHopRequest,
    *,
    llm: LlmClient,
    store: InMemoryIdempotencyStore | None = None,
) -> AnalyzeResult:
    store = store or InMemoryIdempotencyStore()

    # ADR-0004 amendment #6: for a video-URL submission, the input IS the
    # user's quote, carried through untouched. Never fabricate a transcript
    # by calling a transcriber here.
    is_video_url = request.content.is_video_url_submission
    submitted_text = request.content.quote if is_video_url else (request.content.text or "")
    attribution = "unverified" if is_video_url else None

    cache_key = f"analyze:{request.submission_id}:{content_hash(submitted_text or '')}"
    cached = store.get(cache_key)
    if cached is not None:
        assert isinstance(cached, AnalyzeResult)
        return cached

    prompt = build_analyze_prompt(submitted_text=submitted_text or "", language_hint=request.language_hint)

    last_error: Exception | None = None
    for _attempt in range(2):  # ADR-0023 §1: retry once on schema violation, then fail
        try:
            raw, usage = await llm.complete_with_usage(prompt, stage="analyze", max_tokens=1024)
            language, translation_en, raw_claims = _parse_and_validate(raw)
            detected = [DetectedClaim(text=c["text"], claim_type=c["claim_type"]) for c in raw_claims]
            detected = _apply_editor_sampling(detected)
            result = AnalyzeResult(
                language=language,
                translation_en=translation_en,
                claims=detected,
                attribution=attribution,
                usage=usage,
            )
            store.set(cache_key, result)
            return result
        except (
            LlmCompletionError,
            json.JSONDecodeError,
            ValidationError,
            KeyError,
            ValueError,
            TypeError,
        ) as exc:
            last_error = exc
            continue

    raise AnalyzeHopError(
        f"analyze hop failed schema validation twice for submission {request.submission_id}: {last_error}"
    ) from last_error


__all__ = ["AnalyzeHopError", "UsageRecord", "run_analyze_hop"]
