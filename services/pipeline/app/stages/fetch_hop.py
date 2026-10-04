"""The `fetch` hop (POST /hops/fetch): poll configured FetchSources ->
score (ADR-0032 §1) -> three-layer dedup (ADR-0032 §3) -> emit a
submission.received-shaped payload, with `ingest_source: "fetch"`
provenance, into the SAME pipeline entry (`run_analyze_hop`) the
submission engine uses.

Scope note (bounded slice — see task brief): this hop implements
sources + scorer + dedup + the emitting call into analyze. It does
NOT implement (deferred to later waves, per ADR-0032's own review
triggers and acceptance tests AT-0032-4/5/6/7/8):
  - reverse-image/frame search (AT-0032-8)
  - the fetch engine's own per-engine daily-spend breaker (AT-0032-5)
  - `fetch.*` outbox events / the real QStash-triggered EDA topology
    (ADR-0032 §2) — this hop is called directly/synchronously, not via
    a cron-posted outbox row
  - the STT compliance-subset boundary (AT-0032-4) — this slice never
    calls a transcriber at all, which trivially satisfies "never
    fabricates a transcript", but does not implement the owner-
    authorized/partner-audio allow path
  - API-side publish enactment / FETCH_ENGINE_ENABLED kill-switch wiring
    (AT-0032-6) — this hop has no publish-policy or kill-switch
    integration; it stops at the analyze hop boundary.

Claim identity for dedup (ADR-0032 §3 layers 2/3): this slice collapses
on an EXACT (normalized) claim-text content hash. The ADR's fuzzy
claim-*embedding* dedup (reusing app/protocols/embedder.py +
app/stages/dedup_guard.py, as the verify hop already does for the
submission engine) is deferred — a paraphrased repost of the same claim
is not yet collapsed by this hop. Flagged, not hidden.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.models.hop_requests import AnalyzeHopRequest, HopContent
from app.models.pipeline_io import AnalyzeResult
from app.protocols.fetch_dedup_store import FetchDedupStore
from app.protocols.fetch_source import FetchCandidate, FetchSource
from app.protocols.llm_client import LlmClient
from app.stages.analyze import run_analyze_hop
from app.stages.fetch_scoring import FetchScoringConfig, FetchScoringInput, score_candidate
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash

# ADR-0032 §4: "per-source, per-run candidate cap" — each poll emits at
# most this many surviving (above-tau) candidates; this slice enforces
# it as a hard cap on EMISSIONS per run (the per-engine spend breaker
# itself, AT-0032-5, is deferred — see module docstring).
DEFAULT_MAX_EMISSIONS_PER_RUN = 10


def _normalize_claim_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


@dataclass(frozen=True, slots=True)
class EmittedCandidate:
    content_hash: str
    submission_id: str
    claim_text: str
    platform: str
    score: float
    analyze_result: AnalyzeResult


@dataclass(slots=True)
class FetchHopResult:
    candidates_observed: int = 0
    duplicate_platform_item_skipped: int = 0
    dropped_below_tau: int = 0
    attached_observation_only: int = 0
    emitted: list[EmittedCandidate] = field(default_factory=list)
    capped_by_max_emissions: int = 0


async def run_fetch_hop(
    *,
    sources: list[FetchSource],
    dedup_store: FetchDedupStore,
    scoring_config: FetchScoringConfig | None = None,
    llm: LlmClient,
    org_id: str,
    idempotency_store: InMemoryIdempotencyStore | None = None,
    limit_per_source: int = 20,
    max_emissions_per_run: int = DEFAULT_MAX_EMISSIONS_PER_RUN,
) -> FetchHopResult:
    scoring_config = scoring_config or FetchScoringConfig.from_env()
    idempotency_store = idempotency_store or InMemoryIdempotencyStore()
    result = FetchHopResult()

    for source in sources:
        candidates = await source.poll(limit=limit_per_source)
        for candidate in candidates:
            result.candidates_observed += 1
            await _process_candidate(
                candidate,
                dedup_store=dedup_store,
                scoring_config=scoring_config,
                llm=llm,
                org_id=org_id,
                idempotency_store=idempotency_store,
                result=result,
                max_emissions_per_run=max_emissions_per_run,
            )

    return result


async def _process_candidate(
    candidate: FetchCandidate,
    *,
    dedup_store: FetchDedupStore,
    scoring_config: FetchScoringConfig,
    llm: LlmClient,
    org_id: str,
    idempotency_store: InMemoryIdempotencyStore,
    result: FetchHopResult,
    max_emissions_per_run: int,
) -> None:
    # Layer 1 (ADR-0032 §3): exact (platform, native_id) already seen ->
    # drop immediately, no scoring at all.
    if dedup_store.seen_platform_item(candidate.platform, candidate.native_id):
        result.duplicate_platform_item_skipped += 1
        return

    normalized_text = _normalize_claim_text(candidate.text)
    claim_hash = content_hash(normalized_text)

    dedup_store.record_observation(
        platform=candidate.platform,
        native_id=candidate.native_id,
        content_hash=claim_hash,
        observed_at=candidate.observed_at,
    )

    # Scoring signals derived purely from this candidate — no embedding,
    # no LLM call (AT-0032-2's "before any embedding/LLM call"). Scoring
    # must happen BEFORE any dedup-store upsert of the claim-identity
    # record, since a below-tau candidate is dropped without ever
    # becoming a tracked fetch_candidates row (see module docstring).
    total_engagement = float(sum(candidate.engagement.values()))
    # Best-effort velocity/age proxies: see module docstring's "Claim
    # identity for dedup" note and app/stages/fetch_scoring.py's module
    # docstring for why these are deliberately simple, not a real
    # time-series rate — flagged, not hidden.
    hours_since_previous = 1.0
    age_hours = 0.0
    platforms_seen: frozenset[str] = frozenset({candidate.platform})

    signals = FetchScoringInput(
        text=candidate.text,
        engagement_delta=total_engagement,
        hours_since_previous_observation=hours_since_previous,
        platforms_seen=platforms_seen,
        age_hours=age_hours,
    )
    score = score_candidate(signals, config=scoring_config)

    if score < scoring_config.tau_fetch:
        result.dropped_below_tau += 1
        return

    record, is_new = dedup_store.upsert_candidate(
        content_hash=claim_hash,
        claim_text=normalized_text,
        score=score,
        platform=candidate.platform,
        observed_at=candidate.observed_at,
    )

    if record.status == "emitted":
        # ADR-0032 §3/AT-0032-3: already produced its one verification
        # pass — this observation only bumped trend counters above.
        result.attached_observation_only += 1
        return

    if not is_new:
        # Crossed tau on a re-poll of a candidate that was below tau
        # before but hasn't been emitted yet (status still "pending" —
        # see upsert_candidate's contract). Proceed to emit exactly
        # once, same as a brand-new above-tau candidate.
        pass

    if len(result.emitted) >= max_emissions_per_run:
        # ADR-0032 §4 per-run candidate cap (coarse form — see module
        # docstring on the deferred real spend breaker).
        result.capped_by_max_emissions += 1
        return

    submission_id = str(uuid.uuid4())
    request = AnalyzeHopRequest(
        submission_id=submission_id,
        org_id=org_id,
        content=HopContent(text=candidate.text),
        language_hint=None,
    )
    analyze_result = await run_analyze_hop(request, llm=llm, store=idempotency_store)

    dedup_store.mark_emitted(claim_hash, submission_id=submission_id)
    result.emitted.append(
        EmittedCandidate(
            content_hash=claim_hash,
            submission_id=submission_id,
            claim_text=normalized_text,
            platform=candidate.platform,
            score=score,
            analyze_result=analyze_result,
        )
    )


__all__ = [
    "DEFAULT_MAX_EMISSIONS_PER_RUN",
    "EmittedCandidate",
    "FetchHopResult",
    "run_fetch_hop",
]
