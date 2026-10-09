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
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse

from pydantic import ValidationError

from app.models.enums import CredibilityTier
from app.models.hop_requests import VerifyHopRequest
from app.models.pipeline_io import (
    Citation,
    CorroborationPayload,
    DraftVerdictOutput,
    PublishDecisionPayload,
    UsageRecord,
    VerifyEvidence,
    VerifyResult,
)
from app.prompts.templates import build_draft_verdict_prompt
from app.protocols.check_store import CheckStore
from app.protocols.corroboration import Corroboration, CorroborationError

# ADR-0036 grounded rescue: a grounded web assessment call costs ~$0.04 (same as
# a grounded corroboration), charged to the shared "corroboration" daily lane.
GROUNDED_RESCUE_USD = 0.04

# Credibility ordering for picking the STRONGEST grounded citation as the lead
# evidence source (ADR-0038 flywheel). Higher = more credible. Used only to
# choose which surfaced publisher anchors the grounded-assessment evidence row;
# never a retrieval filter (ADR-0004 §5).
_TIER_RANK: dict[CredibilityTier, int] = {
    CredibilityTier.tier1_primary: 4,
    CredibilityTier.tier2_established_media: 3,
    CredibilityTier.tier3_general: 2,
    CredibilityTier.tier4_unverified: 1,
}


def _grounded_rescue_enabled() -> bool:
    """When the Fact Check Tools API returns NO sources, consult grounded Gemini
    for a sourced assessment the draft can cite (instead of an inconclusive,
    held draft). Default ON; set GROUNDED_RESCUE_ENABLED=false to disable."""
    return os.environ.get("GROUNDED_RESCUE_ENABLED", "true").strip().lower() != "false"


def _preliminary_threads_enabled() -> bool:
    """ADR-0038 FEATURE_PRELIMINARY_THREADS (read FRESH from os.environ every
    call so it is flippable at runtime, not import-time baked).

    Default ON — materialising a non-auto-published item as a public
    `preliminary`/`awaiting_sources` editorial thread (instead of an invisible
    held draft) is the whole point of ADR-0038. Flip to false to fall back to
    today's held-draft behaviour: auto-publish still emits lifecycle="published"
    (unchanged publish semantics), but held items emit NO editorial lifecycle
    (lifecycle=None), exactly as before this ADR."""
    return os.environ.get("FEATURE_PRELIMINARY_THREADS", "true").strip().lower() != "false"


# ADR-0038 provenance tag for an AI-grounded, non-authoritative preliminary
# thread-starter (carried on the wire as PublishDecisionPayload.source_kind so
# the API can persist checks.source_kind). The only non-null source_kind this
# hop emits today.
_AI_GROUNDED_PRELIMINARY = "ai_grounded_preliminary"


def _editorial_lifecycle(
    *,
    auto_publish: bool,
    rescue_has_assessment: bool,
    named_person_involved: bool = False,
    dismissed: bool = False,
) -> tuple[str | None, str | None, bool]:
    """Compute the ADR-0038 editorial OUTCOME `(lifecycle, source_kind,
    authoritative)` the API will persist. The *processing* decision
    (auto_publish) is untouched; this is the orthogonal editorial track.

    - auto-publish, NON-named → ("published", None, True) — ALWAYS, flag on or
      off (auto-publish semantics are unchanged by ADR-0038).
    - auto-publish, NAMED-person → ("editor_review", None, False). HARD LEGAL
      INVARIANT (ADR-0033/0004, ADR-0038 state machine): no [A] edge ever
      reaches `published` for a named person — the only named→published edge is
      [E] (a human approve). This guard is REQUIRED, not belt-and-braces:
      finalize_publish's Tier-C mode (a) returns auto_publish=True for a
      named-person claim at calibrated_confidence ≥ TAU_C_MODE_A (0.99) —
      verified empirically — so the editorial track must itself refuse to mark a
      named-person outcome `published` and instead route it to the bounded
      editor queue. This is exactly the Wave 2 re-verify case: injected
      authoritative sources can clear a named-person claim into the
      auto_publish=True band, and it MUST land in editor_review, never published.
    - FLAG OFF (and not auto-publish) → (None, None, True): byte-for-byte the
      pre-ADR-0038 held-draft behaviour — no editorial lifecycle emitted.
    - FLAG ON, held, rescue produced an assessment → preliminary (AI-grounded,
      non-authoritative). Rating-withholding for named persons is unchanged (the
      API withholds `verdict.rating` pre-approval, per the contract below).
    - FLAG ON, held, no usable rescue → awaiting_sources (open thread, no verdict).
    - FLAG ON, hard failure (rejected draft) → dismissed.
    """
    if auto_publish:
        if named_person_involved:
            # Named-person clear routes to the bounded editor queue (ADR-0038
            # transition table: preliminary·awaiting_sources → editor_review,
            # [C]/[A]/[E], "never auto"). NOT "published".
            return "editor_review", None, False
        return "published", None, True
    if not _preliminary_threads_enabled():
        return None, None, True
    if dismissed:
        return "dismissed", None, False
    if rescue_has_assessment:
        return "preliminary", _AI_GROUNDED_PRELIMINARY, False
    return "awaiting_sources", None, False
from app.clients.corroboration_gemini import grounded_model_name
from app.protocols.embedder import Embedder
from app.protocols.factcheck_client import FactCheckClient
from app.protocols.llm_client import LlmClient, LlmCompletionError
from app.protocols.reverse_image import ReverseImageSearch, ReverseImageSearchError
from app.registry.credibility import render_registry_as_prompt_context, tier_for_url
from app.stages.citation_guard import CitationIntegrityError, RetrievedDoc, verify_citations
from app.stages.corroboration import run_corroboration
from app.stages.dedup_guard import may_reuse
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash
from app.stages.json_extract import strip_code_fences
from app.stages.publish import finalize_publish
from app.stores.engine_breaker import EngineCostBreaker, reserve_or_refund
from app.stores.llm_call_store import LlmCall, LlmCallStore

# Cosine-similarity threshold for dedup reuse (ADR-0004 step 3 / amendment
# #8). Not yet tuned against a real eval set (tracked as tech debt — see
# ADR-0004's own trade-off note on needing a 100+ claim eval set).
DEDUP_TAU = 0.92


class DraftVerdictError(Exception):
    """Raised when the draft-verdict call cannot produce a schema-valid,
    citation-clean result after one retry (ADR-0023 §1/§2)."""


def _parse_draft(raw: str) -> DraftVerdictOutput:
    payload = json.loads(strip_code_fences(raw))
    return DraftVerdictOutput.model_validate(payload)


async def _draft_once(
    *,
    claim_text: str,
    retrieved: list[RetrievedDoc],
    llm: LlmClient,
    named_person_involved: bool,
    source_meta: dict[str, _SourceMeta] | None = None,
) -> tuple[DraftVerdictOutput, UsageRecord]:
    # ADR-0038 relevance/recency guard: pass each source's tier + date so the
    # draft can weigh RELEVANCE and CURRENCY (doc_id -> (tier, published_at)).
    meta = source_meta or {}
    annotations = {doc_id: (m.credibility_tier.value, m.published_at) for doc_id, m in meta.items()}
    prompt = build_draft_verdict_prompt(
        claim_text=claim_text,
        retrieved_sources=[(doc.doc_id, doc.text) for doc in retrieved],
        credibility_context=render_registry_as_prompt_context(),
        named_person_involved=named_person_involved,
        source_meta=annotations,
    )
    # ADR-0034 raised the draft's output size (the new `context` field, on top
    # of already token-dense citation URLs + rationale), so 1024 output tokens
    # truncated the JSON mid-string -> parse failure -> reject. 3072 gives
    # comfortable headroom for context(<=2000c) + rationale(<=4000c) + cited
    # quotes without truncating. (Verified: 1024 reproduced "Unterminated
    # string" on the COVID claim; 3072 returns complete JSON.)
    raw, usage = await llm.complete_with_usage(prompt, stage="verify", max_tokens=3072)
    draft = _parse_draft(raw)
    # ADR-0023 §2 / AT-0023-2 / AT-0023-3: enforced in code, never trusted
    # from the model.
    verify_citations(draft.citations, retrieved)
    # ADR-0034: context leads the published artifact, so a rating-bearing draft
    # MUST carry non-empty context. Raise like a citation violation so the
    # caller's retry-once-then-reject loop routes a context-less draft to the
    # rejected path instead of letting it reach auto-publish.
    if draft.rating is not None and not (draft.context and draft.context.strip()):
        raise CitationIntegrityError("rating-bearing draft is missing required context (ADR-0034)")
    return draft, usage


@dataclass(frozen=True)
class _SourceMeta:
    url: str
    title: str
    publisher: str
    credibility_tier: CredibilityTier
    published_at: str | None


def _build_evidence(
    citations: list[Citation],
    source_meta: dict[str, _SourceMeta],
) -> list[VerifyEvidence]:
    """Pair each citation-integrity-checked citation (ADR-0023 §2) with the
    structured source metadata captured when its doc was retrieved, producing
    the persistable `evidence[]` a published Check requires (ADR-0031
    AT-0031-1). A cited doc with no URL-bearing source is skipped (SourceSchema
    requires a URL); deduped by (url, quote)."""
    out: list[VerifyEvidence] = []
    seen: set[tuple[str, str]] = set()
    for citation in citations:
        meta = source_meta.get(citation.doc_id)
        if meta is None or not meta.url:
            continue
        key = (meta.url, citation.quoted_span)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            VerifyEvidence(
                url=meta.url,
                title=meta.title or meta.publisher or "Source",
                publisher=meta.publisher or "unknown",
                credibility_tier=meta.credibility_tier,
                quote=citation.quoted_span,
                published_at=meta.published_at,
            )
        )
    return out


async def run_verify_hop(
    request: VerifyHopRequest,
    *,
    llm: LlmClient,
    embedder: Embedder,
    check_store: CheckStore,
    factcheck_client: FactCheckClient,
    store: InMemoryIdempotencyStore | None = None,
    reverse_image_search: ReverseImageSearch | None = None,
    corroboration_client: Corroboration | None = None,
    corroboration_breaker: EngineCostBreaker | None = None,
    # Per-call cost audit (ADR-0011 §7 / llm_calls). Optional + fake-first: a
    # caller that does not wire it records nothing (existing callers/tests are a
    # pure no-op). app/main.py passes the env-selected Postgres/in-memory store.
    # Used ONLY for the grounded-rescue row below — the rescue's usd is not
    # surfaced in VerifyResult, so unlike the draft/corroboration rows (written at
    # the hop boundary in app/main.py from the result) it must be recorded here.
    llm_call_store: LlmCallStore | None = None,
) -> VerifyResult:
    store = store or InMemoryIdempotencyStore()
    if corroboration_client is None:
        # Fakes-first default, same convention as `reverse_image_search`: a
        # caller that doesn't wire the ADR-0036 second gate gets the
        # deterministic fake (which fails closed to no_second_opinion), so
        # existing verify-hop callers are a pure no-op. app/main.py passes the
        # env-selected instance (app/clients/corroboration_factory.py).
        from app.fakes.fake_corroboration import FakeCorroboration

        corroboration_client = FakeCorroboration()
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
                    # ADR-0034: a rating-bearing verdict carries context; this
                    # dedup short-circuit reuses a prior check's assessment, so
                    # the context points the reader to it rather than restating
                    # synthesis this path never recomputed.
                    context=(
                        "This claim matches a previously assessed one; the existing "
                        "check's context and evidence apply. See the reused assessment "
                        f"({candidate.check_id})."
                    ),
                    language=request.language,
                    translation_en=request.claim_text,
                ),
                reused_existing_check=True,
                reused_check_id=candidate.check_id,
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
    # doc_id -> structured source metadata, captured here (where the url/
    # publisher are still available) so citations can be turned into
    # persistable evidence after the draft passes integrity checks.
    source_meta: dict[str, _SourceMeta] = {}

    # --- ADR-0038 Wave 2 re-verify entry: crowdsourced injected sources ---
    # When the API re-enqueues an open preliminary/awaiting_sources check with
    # community-submitted, API-tier-gated (≤2) sources, fold them into
    # `retrieved` FIRST — before the reverse-image and Fact Check Tools hits,
    # and crucially before the `if not retrieved` no-source rescue guard below.
    # A re-verify with real evidence therefore DRAFTS AGAINST these docs and
    # never falls through to the grounded rescue; the draft rates on the
    # injected evidence and routes per the ADR transition table (non-named may
    # auto-publish; named-person is held to editor_review by _editorial_lifecycle
    # — never auto, the hard legal invariant).
    #
    # Tiering: the API already resolved + tier-gated these to ≤2 (authoritative)
    # via its fuller credibility_registry/resolved_url; the pipeline does NOT
    # re-tier them down here (it lacks that resolved-URL context and tier_for_url
    # would under-credit a genuinely authoritative URL absent from this service's
    # registry), so they carry tier2_established_media as citable evidence. The
    # draft-verdict LLM still decides the rating — never a hardcoded verdict
    # (ADR-0023 citation integrity is enforced in code as for any other source).
    if request.injected_docs:
        for i, inj in enumerate(request.injected_docs):
            inj_doc_id = f"injected-source:{i}"
            retrieved.append(RetrievedDoc(doc_id=inj_doc_id, text=inj.text))
            source_meta[inj_doc_id] = _SourceMeta(
                url=inj.url,
                title=inj.title,
                publisher=inj.title,
                credibility_tier=CredibilityTier.tier2_established_media,
                published_at=None,
            )

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
            ri_doc_id = f"reverse-image-earlier-copy:{request.media_hash}"
            retrieved.append(
                RetrievedDoc(
                    doc_id=ri_doc_id,
                    text=(
                        f"Reverse-image search found an earlier copy of this media at "
                        f"{earlier_copy.source_url}, first seen {earlier_copy.found_at} — "
                        "earlier than this submission. This is consistent with "
                        "recycled/misattributed footage rather than new, original "
                        "footage of a current event."
                    ),
                )
            )
            if earlier_copy.source_url:
                source_meta[ri_doc_id] = _SourceMeta(
                    url=earlier_copy.source_url,
                    title="Earlier copy of this media (reverse-image match)",
                    publisher="Reverse-image match",
                    credibility_tier=CredibilityTier.tier4_unverified,
                    published_at=None,
                )

    # --- retrieve (ADR-0004 step 4): our prior checks already queried
    # above via check_store; Fact Check Tools API is the second source. ---
    factcheck_hits = await factcheck_client.search(request.claim_text, language_code=request.language[:2])
    for hit in factcheck_hits:
        retrieved.append(
            RetrievedDoc(doc_id=hit.doc_id, text=f"{hit.text} — {hit.publisher} ({hit.review_date})")
        )
        # A hit with no URL can't become a `sources` row (SourceSchema needs a
        # URL), so it stays citable context but is never emitted as evidence.
        if hit.url:
            source_meta[hit.doc_id] = _SourceMeta(
                url=hit.url,
                title=(hit.text[:200].strip() or hit.publisher or "Fact-check"),
                publisher=hit.publisher or "unknown",
                credibility_tier=tier_for_url(hit.url),
                published_at=hit.review_date,
            )

    # --- grounded RESCUE (ADR-0036): the Fact Check Tools API is sparse — it only
    # matches claims already in a fact-check database. When it returns NO sources
    # the draft would rate "inconclusive" and be held, which is why most claims
    # never publish. Instead, consult grounded Gemini web search for a sourced
    # assessment the draft can cite (tier4_unverified, clearly AI-grounded), so
    # the claim gets a real, cited verdict that flows through the normal publish
    # policy + audit. Cost-bounded (shared "corroboration" daily lane) and
    # fail-open: any error degrades to the unchanged no-source draft. ---
    # ADR-0038: a rescue that produces an assessment (stance + text) WITH OR
    # WITHOUT citations makes the item a `preliminary` AI-grounded thread-starter
    # rather than an invisible held draft. We record whether an assessment came
    # back so the editorial-lifecycle outcome can branch on it below, decoupled
    # from whether grounding happened to surface a citable URL this call (which
    # Vertex returns non-deterministically — see corroboration_gemini retry).
    #
    # ADR-0038 flywheel closer: ALSO re-ground on a CROWDSOURCE RE-VERIFY
    # (injected_docs present). A re-verify's injected docs carry only the
    # submitter's NOTE + domain title as text — never the article body, because
    # the publishers block our egress IP (see reference-cloudrun-egress-ip-block).
    # Drafting against those thin labels alone can't verify anything (observed in
    # prod: the KTN claim stayed awaiting_sources with "the sources do not verify
    # this — one is a bare label, the other a one-line summary"). So when a
    # re-verify injects authoritative sources, we grind fresh grounded web
    # evidence TOO and let the draft rate against grounding + the injected
    # authoritative tiers together — turning a credibility SIGNAL into an actual
    # verdict. Grounding runs from Google infra (not IP-blocked), unlike a direct
    # fetch of the submitted URL. Cost-bounded by the same breaker.
    rescue_has_assessment = False
    if (not retrieved or request.injected_docs) and _grounded_rescue_enabled() and request.claim_text.strip():
        # rescue_usd is left None unless a rescue call actually returns, so the
        # cost row below is recorded only for a rescue that really ran.
        rescue_usd: float | None = None
        allow = True
        if corroboration_breaker is not None:
            try:
                # Reserve-then-check WITH refund-on-deny: a denied rescue must not
                # leave its estimate on the lane's total (see reserve_or_refund).
                allow = reserve_or_refund(corroboration_breaker, "corroboration", GROUNDED_RESCUE_USD)
            except Exception:  # noqa: BLE001 - cost metering must NEVER crash the verify hop
                allow = False  # fail-closed: skip the billable rescue if we can't meter it
        if allow:
            try:
                _rescue_stance, assessment_text, cite_urls, rescue_usd = await corroboration_client.rescue(
                    claim_text=request.claim_text, language=request.language
                )
                # Per-call cost audit for the grounded no-source rescue (ADR-0011
                # §7 / llm_calls). Recorded HERE (not at the app/main.py hop
                # boundary) because the rescue's usd is not carried out in
                # VerifyResult. The gemini SDK returns only a usd estimate for a
                # rescue (no token breakdown — see _estimate_usd in
                # corroboration_gemini), so token counts are 0. `store.record` is
                # contractually fail-open (never raises; logs its own failures —
                # this module has no logger), so no try/except is needed and the
                # hop can never be failed by this bookkeeping. This sits BEFORE the
                # citation/tier block below and does not touch it.
                if llm_call_store is not None:
                    llm_call_store.record(
                        LlmCall(
                            org_id=request.org_id,
                            stage="grounded_rescue",
                            model=grounded_model_name(),
                            input_tokens=0,
                            cached_tokens=0,
                            output_tokens=0,
                            usd=rescue_usd,
                        )
                    )
                if assessment_text.strip():
                    # An assessment exists → preliminary-eligible regardless of
                    # citations (ADR-0038 behaviour #2). The rescue is NO LONGER
                    # discarded when `cite_urls` is empty (the bug that killed a
                    # real prod Swahili claim: 0 citations one call, many the next).
                    rescue_has_assessment = True
                    if cite_urls:
                        # Citations present → append the AI assessment as the citable
                        # evidence doc the draft quotes. Absent → still preliminary
                        # (above), but no evidence doc to build; the API surfaces the
                        # AI stance/summary as the non-authoritative thread-starter.
                        #
                        # ADR-0038 flywheel fix: tier this by the STRONGEST surfaced
                        # publisher via the SAME credibility registry the API uses for
                        # human-submitted sources (tier_for_url), instead of a blanket
                        # tier4 that buried a genuinely authoritative KE source
                        # (nation.africa, standardmedia, pesacheck …). The quote stays
                        # a real span of the grounded assessment, so ADR-0023 §2
                        # citation integrity AND VerifyEvidence's "real quoted source"
                        # invariant are both preserved; the "(via {host})" title keeps
                        # the AI-grounded provenance explicit to the reader. This does
                        # NOT move the publish gate — decide_publish_policy is
                        # confidence-/risk-tier-driven and never reads evidence tier
                        # (verified in publish.py) — so richer tiering can never
                        # auto-publish an AI-only verdict; it only makes the thread's
                        # lead source honest and correctly weighted.
                        #
                        # Only the strongest citation is emitted as evidence: the
                        # OTHER surfaced URLs have no fetchable text to quote (their
                        # publishers block our egress IP), so emitting them as
                        # VerifyEvidence would require a fabricated quote and break the
                        # "real quoted source" invariant. Surfacing them as un-quoted
                        # "referenced sources" is a deliberate follow-up (needs a
                        # separate wire/UI channel), not a silent invariant weakening.
                        anchor_url = max(
                            cite_urls,
                            key=lambda u: _TIER_RANK.get(
                                tier_for_url(u, default=CredibilityTier.tier4_unverified), 0
                            ),
                        )
                        anchor_host = (urlparse(anchor_url).hostname or "").removeprefix("www.") or "grounded web search"
                        rescue_doc_id = "grounded-web-assessment"
                        retrieved.append(RetrievedDoc(doc_id=rescue_doc_id, text=assessment_text))
                        source_meta[rescue_doc_id] = _SourceMeta(
                            url=anchor_url,
                            title=f"AI-grounded web assessment (via {anchor_host})",
                            publisher=anchor_host,
                            credibility_tier=tier_for_url(anchor_url, default=CredibilityTier.tier4_unverified),
                            published_at=None,
                        )
            except CorroborationError:
                pass  # fail-open: unchanged no-source draft path

    # --- draft verdict + citation integrity, retry once then fail ---
    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            draft, usage = await _draft_once(
                claim_text=request.claim_text,
                retrieved=retrieved,
                llm=llm,
                named_person_involved=request.named_person_involved,
                source_meta=source_meta,
            )
            # ADR-0004 amendment #5: a named-person draft never carries a
            # visible rating to the submitter until editor approval. We
            # still compute/store the model's rating internally (editors
            # need it) but the caller (API layer, out of scope here) is
            # responsible for withholding it pre-approval; we flag it so
            # that contract is visible at this boundary too.
            result = VerifyResult(
                verdict=draft,
                evidence=_build_evidence(draft.citations, source_meta),
                reused_existing_check=False,
                valid_as_of=datetime.now(UTC).date().isoformat(),
                usage=usage,
            )
            # ADR-0031 amendment (C1 gap): the ONE real, non-test call
            # into decide_publish_policy (via app.stages.publish.
            # finalize_publish), for every completed draft on either
            # engine (submission today; the ADR-0032 fetch engine once
            # it converges on this same hop).
            # ADR-0036: the independent grounded second gate, run ONLY on the
            # decision-boundary slice (see run_corroboration's sampling). Its
            # agreement feeds finalize_publish via the calibration map (zero
            # lift in shadow mode); any failure fails closed to no_second_opinion.
            corroboration = await run_corroboration(
                draft=draft,
                claim_text=request.claim_text,
                language=request.language,
                named_person_involved=request.named_person_involved,
                attribution=request.attribution.value,
                client=corroboration_client,
                breaker=corroboration_breaker,
            )
            outcome = finalize_publish(
                result,
                named_person_involved=request.named_person_involved,
                attribution=request.attribution.value,
                corroboration=corroboration,
            )
            lifecycle, source_kind, authoritative = _editorial_lifecycle(
                auto_publish=outcome.decision.auto_publish,
                rescue_has_assessment=rescue_has_assessment,
                named_person_involved=request.named_person_involved,
            )
            result = result.model_copy(
                update={
                    "corroboration": CorroborationPayload(
                        agreement_state=corroboration.agreement_state,
                        second_opinion_stance=corroboration.second_opinion_stance,
                        model=corroboration.model,
                        grounding_citations=list(corroboration.grounding_citations),
                        usd=corroboration.usd,
                    ),
                    "publish": PublishDecisionPayload(
                        risk_tier=outcome.risk_tier.value,
                        auto_publish=outcome.decision.auto_publish,
                        reason=outcome.decision.reason,
                        publish_mode=outcome.decision.publish_mode,
                        queued_for_async_audit=outcome.decision.queued_for_async_audit,
                        requires_human_tap=outcome.decision.requires_human_tap,
                        corroboration_state=outcome.corroboration_state,
                        lifecycle=lifecycle,
                        source_kind=source_kind,
                        authoritative=authoritative,
                    ),
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
    # ADR-0038: a hard failure (no schema-valid, citation-clean draft after the
    # retry) is a terminal `dismissed` editorial outcome when the flag is on
    # (auto_publish is always False here by construction, so _editorial_lifecycle
    # routes to dismissed, not published); flag off → None (unchanged).
    rej_lifecycle, rej_source_kind, rej_authoritative = _editorial_lifecycle(
        auto_publish=rejected_outcome.decision.auto_publish,
        rescue_has_assessment=False,
        dismissed=True,
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
                lifecycle=rej_lifecycle,
                source_kind=rej_source_kind,
                authoritative=rej_authoritative,
            )
        }
    )
    store.set(cache_key, rejected_result)
    return rejected_result


__all__ = ["DEDUP_TAU", "Citation", "DraftVerdictError", "run_verify_hop"]
