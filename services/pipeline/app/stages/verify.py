"""The `verify` hop (POST /hops/verify): embed -> dedup gate -> reverse-
image check -> retrieve -> draft verdict, with ADR-0023's citation-
integrity gate enforced before any result is returned as publishable.

Idempotent on content hash, same pattern as analyze.py.

ADR-0032 AT-0032-8 (reverse-image as a first-class check): when the
request carries a `media_hash` (the claim's image/video-thumbnail
fingerprint), this hop asks the ReverseImageSearch Protocol for an
earlier-dated copy BEFORE drafting. A hit is injected into the retrieved-
document set as a citable evidence item -- never a hardcoded verdict:
the draft-verdict LLM call still decides what the evidence means
(recycled/misattributed footage is the dominant KE misinformation tactic
per docs/research/ke-misinformation-landscape-2026.md, so this is
deliberately surfaced as strong evidence rather than buried, but the
rating itself stays the model's call, citation-integrity-checked same as
any other source).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from pydantic import ValidationError

from app.models.hop_requests import VerifyHopRequest
from app.models.pipeline_io import (
    Citation,
    DraftVerdictOutput,
    PublishDecisionPayload,
    UsageRecord,
    VerifyResult,
)
from app.prompts.templates import build_draft_verdict_prompt
from app.protocols.check_store import CheckStore
from app.protocols.embedder import Embedder
from app.protocols.factcheck_client import FactCheckClient
from app.protocols.llm_client import LlmClient, LlmCompletionError
from app.protocols.reverse_image import ReverseImageSearch, ReverseImageSearchError
from app.registry.credibility import render_registry_as_prompt_context
from app.stages.citation_guard import CitationIntegrityError, RetrievedDoc, verify_citations
from app.stages.dedup_guard import may_reuse
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash
from app.stages.publish import finalize_publish

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
    reverse_image_search: ReverseImageSearch | None = None,
) -> VerifyResult:
    store = store or InMemoryIdempotencyStore()
    if reverse_image_search is None:
        # Fakes-first default, same convention as `store` above: a
        # caller that doesn't wire a ReverseImageSearch (most existing
        # tests, pre-ADR-0032-8) gets the deterministic fake rather than
        # a hard failure. app/main.py always passes the real
        # env-selected instance (app/clients/reverse_image_factory.py).
        from app.fakes.fake_reverse_image import FakeReverseImageSearch

        reverse_image_search = FakeReverseImageSearch()
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

    # --- reverse-image check (ADR-0032 AT-0032-8): only runs when this
    # claim carries an image/video-thumbnail fingerprint. A hit on an
    # earlier-dated copy is strong evidence of recycled/misattributed
    # footage -- the dominant KE misinformation tactic -- so it is
    # surfaced FIRST in the retrieved set, ahead of the Fact Check Tools
    # API hits below, but purely as citable evidence: the draft-verdict
    # LLM call decides what it means, never a hardcoded verdict here. ---
    retrieved: list[RetrievedDoc] = []
    if request.media_hash:
        try:
            earlier_copy = reverse_image_search.find_earlier_copy(request.media_hash)
        except ReverseImageSearchError:
            # Best-effort evidence, not a hard dependency: a reverse-
            # image backend outage shouldn't fail the whole verify hop
            # (unlike citation integrity, which is non-negotiable) --
            # degrade to "no earlier-copy evidence available" rather
            # than rejecting the draft.
            #
            # TECH DEBT (flagged, not hidden): this swallows the typed
            # error without logging it anywhere -- no logger is wired in
            # this module today (app/main.py's module-level `logger` is
            # the hop-boundary caller, not this stage). A future pass
            # should propagate this as a structured warning rather than
            # a silent None, so a flaky/misconfigured reverse-image
            # vendor is observable instead of just "no evidence found".
            earlier_copy = None
        if earlier_copy is not None:
            retrieved.append(
                RetrievedDoc(
                    doc_id=f"reverse-image-earlier-copy:{request.media_hash}",
                    text=(
                        f"Reverse-image search found an earlier copy of this media at "
                        f"{earlier_copy.source_url}, first seen {earlier_copy.found_at} — "
                        "earlier than this submission. This is consistent with "
                        "recycled/misattributed footage rather than new, original "
                        "footage of a current event."
                    ),
                )
            )

    # --- retrieve (ADR-0004 step 4): our prior checks already queried
    # above via check_store; Fact Check Tools API is the second source. ---
    factcheck_hits = await factcheck_client.search(request.claim_text, language_code=request.language[:2])
    retrieved.extend(
        RetrievedDoc(doc_id=hit.doc_id, text=f"{hit.text} — {hit.publisher} ({hit.review_date})")
        for hit in factcheck_hits
    )

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
            # ADR-0031 amendment (C1 gap): the ONE real, non-test call
            # into decide_publish_policy (via app.stages.publish.
            # finalize_publish), for every completed draft on either
            # engine (submission today; the ADR-0032 fetch engine once
            # it converges on this same hop).
            outcome = finalize_publish(
                result,
                named_person_involved=request.named_person_involved,
                attribution=request.attribution.value,
            )
            result = result.model_copy(
                update={
                    "publish": PublishDecisionPayload(
                        risk_tier=outcome.risk_tier.value,
                        auto_publish=outcome.decision.auto_publish,
                        reason=outcome.decision.reason,
                        publish_mode=outcome.decision.publish_mode,
                        queued_for_async_audit=outcome.decision.queued_for_async_audit,
                        requires_human_tap=outcome.decision.requires_human_tap,
                    )
                }
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
    # Fail-closed by construction: verdict is None, so
    # finalize_publish's `_rendered_summary` returns None and this
    # NEVER reaches decide_publish_policy's auto_publish=True path (the
    # RED->GREEN "no-summary draft never auto-publishes" case).
    rejected_outcome = finalize_publish(
        rejected_result,
        named_person_involved=request.named_person_involved,
        attribution=request.attribution.value,
    )
    rejected_result = rejected_result.model_copy(
        update={
            "publish": PublishDecisionPayload(
                risk_tier=rejected_outcome.risk_tier.value,
                auto_publish=rejected_outcome.decision.auto_publish,
                reason=rejected_outcome.decision.reason,
                publish_mode=rejected_outcome.decision.publish_mode,
                queued_for_async_audit=rejected_outcome.decision.queued_for_async_audit,
                requires_human_tap=rejected_outcome.decision.requires_human_tap,
            )
        }
    )
    store.set(cache_key, rejected_result)
    return rejected_result


__all__ = ["DEDUP_TAU", "Citation", "DraftVerdictError", "run_verify_hop"]
