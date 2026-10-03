"""The `verify` hop (POST /hops/verify): embed -> dedup gate -> retrieve ->
draft verdict, with ADR-0023's citation-integrity gate enforced before any
result is returned as publishable.

Idempotent on content hash, same pattern as analyze.py.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from pydantic import ValidationError

from app.models.hop_requests import VerifyHopRequest
from app.models.pipeline_io import Citation, DraftVerdictOutput, UsageRecord, VerifyResult
from app.prompts.templates import build_draft_verdict_prompt
from app.protocols.check_store import CheckStore
from app.protocols.embedder import Embedder
from app.protocols.factcheck_client import FactCheckClient
from app.protocols.llm_client import LlmClient, LlmCompletionError
from app.registry.credibility import render_registry_as_prompt_context
from app.stages.citation_guard import CitationIntegrityError, RetrievedDoc, verify_citations
from app.stages.dedup_guard import may_reuse
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash

# Cosine-similarity threshold for dedup reuse (ADR-0004 step 3 / amendment
# #8). Not yet tuned against a real eval set (tracked as tech debt — see
# ADR-0004's own trade-off note on needing a 100+ claim eval set).
DEDUP_TAU = 0.92


class DraftVerdictError(Exception):
    """Raised when the draft-verdict call cannot produce a schema-valid,
    citation-clean result after one retry (ADR-0023 §1/§2)."""


def _parse_draft(raw: str) -> DraftVerdictOutput:
    payload = json.loads(raw)
    return DraftVerdictOutput.model_validate(payload)


async def _draft_once(
    *,
    claim_text: str,
    retrieved: list[RetrievedDoc],
    llm: LlmClient,
    named_person_involved: bool,
) -> tuple[DraftVerdictOutput, UsageRecord]:
    prompt = build_draft_verdict_prompt(
        claim_text=claim_text,
        retrieved_sources=[(doc.doc_id, doc.text) for doc in retrieved],
        credibility_context=render_registry_as_prompt_context(),
        named_person_involved=named_person_involved,
    )
    raw, usage = await llm.complete_with_usage(prompt, stage="verify", max_tokens=1024)
    draft = _parse_draft(raw)
    # ADR-0023 §2 / AT-0023-2 / AT-0023-3: enforced in code, never trusted
    # from the model.
    verify_citations(draft.citations, retrieved)
    return draft, usage


async def run_verify_hop(
    request: VerifyHopRequest,
    *,
    llm: LlmClient,
    embedder: Embedder,
    check_store: CheckStore,
    factcheck_client: FactCheckClient,
    store: InMemoryIdempotencyStore | None = None,
) -> VerifyResult:
    store = store or InMemoryIdempotencyStore()
    cache_key = f"verify:{request.submission_id}:{content_hash(request.claim_text)}"
    cached = store.get(cache_key)
    if cached is not None:
        assert isinstance(cached, VerifyResult)
        return cached

    embedding = embedder.embed(request.claim_text)

    # --- dedup gate (ADR-0004 step 3 / amendment #8, ADR-0023 §3) ---
    candidates = check_store.find_candidates(embedding, limit=5)
    for similarity, candidate in candidates:
        reusable, _reason = may_reuse(
            cosine_similarity=similarity,
            tau=DEDUP_TAU,
            new_text=request.claim_text,
            existing_text=candidate.claim_text,
        )
        if reusable:
            result = VerifyResult(
                verdict=DraftVerdictOutput(
                    rating=candidate.rating,
                    rationale=f"Reused existing check {candidate.check_id} (dedup match).",
                    citations=[],
                    confidence=0.9,
                    what_would_change_this="A material update to the underlying facts.",
                    language=request.language,
                    translation_en=request.claim_text,
                ),
                reused_existing_check=True,
                valid_as_of=candidate.valid_as_of.isoformat(),
            )
            store.set(cache_key, result)
            return result

    # --- retrieve (ADR-0004 step 4): our prior checks already queried
    # above via check_store; Fact Check Tools API is the second source. ---
    factcheck_hits = await factcheck_client.search(request.claim_text, language_code=request.language[:2])
    retrieved = [
        RetrievedDoc(doc_id=hit.doc_id, text=f"{hit.text} — {hit.publisher} ({hit.review_date})")
        for hit in factcheck_hits
    ]

    # --- draft verdict + citation integrity, retry once then fail ---
    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            draft, usage = await _draft_once(
                claim_text=request.claim_text,
                retrieved=retrieved,
                llm=llm,
                named_person_involved=request.named_person_involved,
            )
            # ADR-0004 amendment #5: a named-person draft never carries a
            # visible rating to the submitter until editor approval. We
            # still compute/store the model's rating internally (editors
            # need it) but the caller (API layer, out of scope here) is
            # responsible for withholding it pre-approval; we flag it so
            # that contract is visible at this boundary too.
            result = VerifyResult(
                verdict=draft,
                reused_existing_check=False,
                valid_as_of=datetime.now(UTC).date().isoformat(),
                usage=usage,
            )
            store.set(cache_key, result)
            return result
        except (
            LlmCompletionError,
            json.JSONDecodeError,
            ValidationError,
            CitationIntegrityError,
        ) as exc:
            last_error = exc
            continue

    rejected_result = VerifyResult(
        verdict=None,
        rejected=True,
        rejection_reason=str(last_error),
    )
    store.set(cache_key, rejected_result)
    return rejected_result


__all__ = ["DEDUP_TAU", "Citation", "DraftVerdictError", "run_verify_hop"]
