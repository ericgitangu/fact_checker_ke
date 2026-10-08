"""The `fetch` hop (POST /hops/fetch): poll configured FetchSources ->
score (ADR-0032 §1) -> three-layer dedup (ADR-0032 §3) -> emit a
submission.received-shaped payload, with `ingest_source: "fetch"`
provenance, into the SAME pipeline entry (`run_analyze_hop`) the
submission engine uses.

Scope note (bounded slice — see task brief): this hop implements
sources + scorer + dedup + the emitting call into analyze, PLUS (this
pass, ADR-0032/0017 fetch-enactment slice): the real-outbox emission
path (`emit_submission`, closing the AT-0017-C bypass — see module
docstring below on why `run_analyze_hop` is still the default) and the
per-engine spend breaker (`cost_breaker`, AT-0032-5).

This hop still does NOT implement (deferred to later waves, per
ADR-0032's own review triggers and acceptance tests AT-0032-4/7/8):
  - reverse-image/frame search (AT-0032-8)
  - the STT compliance-subset boundary (AT-0032-4) — this slice never
    calls a transcriber at all, which trivially satisfies "never
    fabricates a transcript", but does not implement the owner-
    authorized/partner-audio allow path
  - fuzzy claim-*embedding* dedup (AT-0032-3's exact-hash collapse is
    implemented; a paraphrased repost of the same claim is not yet
    collapsed) — reuses app/stages/dedup_guard.py the same way the
    submission engine's verify hop already does, deferred to F3/F4
  - API-side enactment of a fetch-sourced publish decision and the
    fetch kill-switch's PUBLISH-side half live in services/api (see
    services/api/src/lib/publish-enactment.ts +
    services/api/src/lib/fetch-kill-switch.ts) — this hop only owns the
    INGESTION-side kill-switch check (app/main.py's
    FETCH_ENGINE_ENABLED read) and the per-engine breaker below.

Claim identity for dedup (ADR-0032 §3 layers 2/3): this slice collapses
on an EXACT (normalized) claim-text content hash. The ADR's fuzzy
claim-*embedding* dedup (reusing app/protocols/embedder.py +
app/stages/dedup_guard.py, as the verify hop already does for the
submission engine) is deferred — a paraphrased repost of the same claim
is not yet collapsed by this hop. Flagged, not hidden.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from app.models.hop_requests import AnalyzeHopRequest, HopContent
from app.models.pipeline_io import AnalyzeResult
from app.protocols.fetch_dedup_store import FetchDedupStore, FetchObservationHistory
from app.protocols.fetch_source import FetchCandidate, FetchSource, FetchSourceError
from app.protocols.llm_client import LlmClient
from app.protocols.transcriber import Transcriber
from app.stages.analyze import run_analyze_hop
from app.stages.fetch_scoring import FetchScoringConfig, FetchScoringInput, score_candidate
from app.stages.idempotency import InMemoryIdempotencyStore, content_hash
from app.stages.stt_gate import resolve_claim_text
from app.stores.engine_breaker import EngineCostBreaker

_log = logging.getLogger(__name__)

# A pluggable "how does a surviving candidate actually become a tracked
# submission" strategy. `run_fetch_hop`'s DEFAULT (`emit_submission=None`)
# keeps calling `run_analyze_hop` in-process — this preserves every
# existing unit test of this module's pure dedup/scoring/capping logic
# with no Postgres dependency. app/main.py's REAL wiring passes a
# strategy backed by app/stores/outbox_postgres.py's
# `emit_fetch_submission_received`, which is what actually closes the
# AT-0017-C "bypasses the outbox" gap in the running system — see that
# module's docstring. Takes (claim_text, org_id, submission_id) and
# returns the (possibly server-confirmed) submission id.
# (claim_text, org_id, submission_id, engagement, source_url, platform) ->
# submission_id. `engagement` (raw views/likes/comments at observation) lets
# the real-outbox emitter derive the virality score; `source_url` (the
# discovered video link) and `platform` are persisted on the submissions row
# so the fetch-DISCOVERED item is surfaceable in the "Trending / under review"
# stream (GET /v1/trending) before/without a published check — see
# app/stores/outbox_postgres.py.
EmitSubmission = Callable[[str, str, str, dict[str, int], str | None, str | None], str]

# ADR-0032 §4: "per-source, per-run candidate cap" — each poll emits at
# most this many surviving (above-tau) candidates; this slice enforces
# it as a hard cap on EMISSIONS per run (the per-engine spend breaker
# itself, AT-0032-5, is deferred — see module docstring).
DEFAULT_MAX_EMISSIONS_PER_RUN = 10

# AT-0032-5: a placeholder per-emission cost estimate metered against the
# fetch engine's breaker (app/stores/engine_breaker.py). NOT a measured
# figure (tracked as tech debt, same class as publish_policy.py's TAU_*
# placeholders) — a real deployment should meter the ACTUAL downstream
# analyze+verify LLM spend this emission goes on to trigger, not a flat
# estimate charged at emission time. Overridable via env for ops tuning
# without a code change.
FETCH_EMISSION_ESTIMATED_USD_COST = float(os.environ.get("FETCH_EMISSION_ESTIMATED_USD_COST", "0.02"))


def _normalize_claim_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


def _reobserve_enabled() -> bool:
    """ADR-0037 FETCH_VELOCITY_REOBSERVE kill-switch. Read FRESH on every
    candidate (same discipline as app/main.py's FETCH_ENGINE_ENABLED read),
    default OFF so this ships dark: flipping it on makes re-observation
    recorded and velocity real within one propagation cycle, with no code
    change and no restart."""
    return os.environ.get("FETCH_VELOCITY_REOBSERVE", "false").lower() == "true"


def _editorial_platforms() -> frozenset[str]:
    """ADR-0032: platforms whose items are EDITORIALLY curated — a newsroom or
    a fact-check desk (or a fact-check-scoped Google News query) already
    surfaced them — rather than virality-ranked.

    Root cause this addresses (verified 2026-10-08, real-scorer run): the
    virality scorer's single largest weight is `velocity`
    (Δengagement/Δtime), which an RSS triage feed can NEVER earn — RSS carries
    no engagement counts, and a first observation has Δ=0 regardless. So a
    curated triage item structurally scores ~0.30-0.40 and is dropped below
    tau=0.5, even though editorial selection is itself the highest-priority
    check-worthiness signal ADR-0032 names ("a claim these outlets have
    already debunked is both the highest-priority 'going viral in KE' signal
    and an authoritative check-against hit"). Empirically, `triage_feed` had
    NEVER emitted a candidate in the system's history because of this.

    For these platforms we floor the score (see `_editorial_floor`) so a
    curated item emits on its editorial provenance, not an engagement rate it
    can't produce. Config-driven (FETCH_EDITORIAL_PLATFORMS, comma-separated),
    default 'triage_feed'. Downstream guards keep this bounded: the per-run
    `max_emissions_per_run` cap, the fetch cost breaker, exact-hash dedup (each
    item emits at most once, ever), and — crucially — the analyze hop's real
    claim detection (`no_checkable_claims`/`needs_quote`), which is the
    authoritative claim filter. A floored non-claim costs one cheap analyze
    call and is then dropped, rather than producing a misleading check."""
    raw = os.environ.get("FETCH_EDITORIAL_PLATFORMS", "triage_feed")
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


def _editorial_floor() -> float:
    """Minimum check-worthiness score for an editorial-platform candidate (see
    `_editorial_platforms`). Default 0.6, above the default tau=0.5 so a
    curated item clears the emission gate. Config-driven (FETCH_EDITORIAL_FLOOR)
    so retuning — or disabling, by setting it below tau — is an env change, not
    a code change (AT-0032-2)."""
    return float(os.environ.get("FETCH_EDITORIAL_FLOOR", "0.6"))


def _velocity_from_history(
    history: FetchObservationHistory, *, observed_at: datetime, total_engagement: float
) -> tuple[float, float, float]:
    """ADR-0037: turn an item's prior observation history + the current
    snapshot into the REAL (hours_since_previous, engagement_delta, age_hours)
    the scorer needs — replacing the pre-ADR-0037 constant placeholders
    (1.0 / total_engagement / 0.0).

    First-ever observation (no prior snapshot): velocity is 0, not an error
    (FetchScoringInput's documented contract) — engagement_delta 0.0 and
    age_hours 0.0 (brand-new), with a nominal 1.0h denominator that a 0 delta
    makes irrelevant.

    Otherwise: engagement_delta = growth since the latest prior snapshot
    (clamped at 0 — a dip in reported counts is not negative virality), over
    the real wall-clock gap; age_hours measured from the FIRST observation."""
    if history.count == 0 or history.latest_observed_at is None:
        return 1.0, 0.0, 0.0

    prev_total = float(sum(history.latest_engagement.values()))
    engagement_delta = max(0.0, total_engagement - prev_total)
    hours_since_previous = (observed_at - history.latest_observed_at).total_seconds() / 3600.0
    first_observed_at = history.first_observed_at or history.latest_observed_at
    age_hours = max(0.0, (observed_at - first_observed_at).total_seconds() / 3600.0)
    return hours_since_previous, engagement_delta, age_hours


@dataclass(frozen=True, slots=True)
class EmittedCandidate:
    content_hash: str
    submission_id: str
    claim_text: str
    platform: str
    score: float
    # None when emitted via the real-outbox path (`emit_submission` —
    # see module docstring): that path hands off to the async relay and
    # has no synchronous AnalyzeResult to report. Only the default
    # in-process `run_analyze_hop` path populates this.
    analyze_result: AnalyzeResult | None = None


@dataclass(slots=True)
class FetchHopResult:
    candidates_observed: int = 0
    duplicate_platform_item_skipped: int = 0
    dropped_below_tau: int = 0
    attached_observation_only: int = 0
    emitted: list[EmittedCandidate] = field(default_factory=list)
    capped_by_max_emissions: int = 0
    # AT-0032-5: candidates that crossed tau and were NOT already
    # emitted, but were skipped at the emission step because the fetch
    # engine's breaker was soft-stopped (>= 80% of its daily budget).
    # Dedup/trend-counter updates for these still ran (upsert_candidate
    # above already happened) — only the emission itself is skipped.
    skipped_soft_stopped: int = 0
    # AT-0032-5: True when this run's hard-stop check (before polling
    # ANY source) found the breaker already at >= 100% — no source was
    # polled at all this run.
    hard_stopped: bool = False
    # ADR-0032/0005 AT-0032-4 / AT-0005-5: a candidate with no
    # claim-bearing text and an audio/video track that is NOT in the
    # lawful/compliant subset (`stt_eligible=False`) hits this
    # short-circuit — same spirit as app/stages/analyze.py's SEC-4
    # `needs_quote` outcome, but one hop earlier: it never reaches
    # scoring, the transcriber, or the LLM at all.
    blocked_non_compliant_media_needs_quote: int = 0


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
    cost_breaker: EngineCostBreaker | None = None,
    emit_submission: EmitSubmission | None = None,
    transcriber: Transcriber | None = None,
) -> FetchHopResult:
    scoring_config = scoring_config or FetchScoringConfig.from_env()
    idempotency_store = idempotency_store or InMemoryIdempotencyStore()
    result = FetchHopResult()

    # AT-0032-5, 100% threshold: "hard-stops polling" — checked ONCE,
    # before any source.poll() call, so an already-exhausted budget
    # never makes even a single outbound fetch-source request this run.
    if cost_breaker is not None and cost_breaker.current_state("fetch").hard_stopped:
        result.hard_stopped = True
        return result

    for source in sources:
        # Per-source isolation: one source's typed failure (a 403'd RSS feed, a
        # YouTube quota/network error) must NEVER abort the whole engine and the
        # other sources with it. Log it and move on — the engine degrades to the
        # sources that are up rather than returning nothing.
        try:
            candidates = await source.poll(limit=limit_per_source)
        except FetchSourceError as exc:
            _log.warning("fetch source %s failed, skipping: %s", source.platform, exc)
            continue
        # Observability (ADR-0038): a source returning an EMPTY list previously
        # logged nothing, so a silently-dead source was indistinguishable from a
        # quiet news day. Log every source's yield so the fetch engine is no
        # longer a black box (the "virals stale" RCA). WARNING level because the
        # app logger defaults to WARNING (no INFO config), and a dead source IS
        # operationally noteworthy.
        _log.warning("fetch source %s returned %d candidate(s)", source.platform, len(candidates))
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
                cost_breaker=cost_breaker,
                emit_submission=emit_submission,
                transcriber=transcriber,
            )

    _log.warning(
        "fetch run complete: observed=%d across %d source(s) [%s]",
        result.candidates_observed,
        len(sources),
        ",".join(s.platform for s in sources),
    )
    return result


async def _resolve_claim_text(candidate: FetchCandidate, *, transcriber: Transcriber | None) -> str | None:
    """ADR-0032/0005 AT-0032-4 / AT-0005-5 STT compliance boundary.

    Delegates to the shared, source-agnostic gate in app/stages/stt_gate.py so
    the fence (third-party audio is NEVER transcribed) lives in ONE place that
    the submission analyze path (ADR-0038) can reuse. Behaviour unchanged.
    """
    return await resolve_claim_text(
        text=candidate.text,
        audio_url=candidate.audio_url,
        stt_eligible=candidate.stt_eligible,
        transcriber=transcriber,
    )


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
    cost_breaker: EngineCostBreaker | None,
    emit_submission: EmitSubmission | None,
    transcriber: Transcriber | None = None,
) -> None:
    reobserve = _reobserve_enabled()

    # Layer 1 (ADR-0032 §3): exact (platform, native_id) already seen ->
    # drop immediately, no scoring at all.
    #
    # ADR-0037 FETCH_VELOCITY_REOBSERVE (default OFF): when ON, a re-observed
    # item is NOT dropped here — it is recorded as a fresh engagement snapshot
    # (below) so velocity becomes a real Δengagement/Δtime rate instead of the
    # static placeholder. Emission idempotency is unaffected: a re-observed
    # claim whose candidate is already `emitted` still short-circuits at the
    # status check downstream (-> attached_observation_only), so re-observation
    # updates trend/velocity but NEVER re-emits (AT-0032-3). When OFF this is
    # the exact pre-ADR-0037 behaviour, byte-for-byte.
    if not reobserve and dedup_store.seen_platform_item(candidate.platform, candidate.native_id):
        result.duplicate_platform_item_skipped += 1
        return

    claim_text = await _resolve_claim_text(candidate, transcriber=transcriber)
    if claim_text is None:
        # AT-0032-4/AT-0005-5: no lawful claim-bearing text at all --
        # never scored, never dedup-tracked as a claim, never reaches
        # the transcriber (ineligible) or the LLM. Mirrors
        # app/stages/analyze.py's SEC-4 `needs_quote` short-circuit one
        # hop earlier.
        result.blocked_non_compliant_media_needs_quote += 1
        return

    normalized_text = _normalize_claim_text(claim_text)
    claim_hash = content_hash(normalized_text)

    # Scoring signals derived purely from this candidate — no embedding,
    # no LLM call (AT-0032-2's "before any embedding/LLM call"). Scoring
    # must happen BEFORE any dedup-store upsert of the claim-identity
    # record, since a below-tau candidate is dropped without ever
    # becoming a tracked fetch_candidates row (see module docstring).
    total_engagement = float(sum(candidate.engagement.values()))
    platforms_seen: frozenset[str] = frozenset({candidate.platform})

    if reobserve:
        # ADR-0037: read the item's prior snapshots (BEFORE recording this
        # one), record this observation as a new engagement snapshot, then
        # derive the REAL velocity deltas from latest-prior -> current.
        history = dedup_store.observation_history(candidate.platform, candidate.native_id)
        dedup_store.record_engagement_snapshot(
            platform=candidate.platform,
            native_id=candidate.native_id,
            content_hash=claim_hash,
            observed_at=candidate.observed_at,
            engagement=candidate.engagement,
        )
        hours_since_previous, engagement_delta, age_hours = _velocity_from_history(
            history, observed_at=candidate.observed_at, total_engagement=total_engagement
        )
    else:
        dedup_store.record_observation(
            platform=candidate.platform,
            native_id=candidate.native_id,
            content_hash=claim_hash,
            observed_at=candidate.observed_at,
        )
        # Best-effort velocity/age proxies: see module docstring's "Claim
        # identity for dedup" note and app/stages/fetch_scoring.py's module
        # docstring for why these are deliberately simple, not a real
        # time-series rate — flagged, not hidden. (ADR-0037 replaces these
        # with the real deltas above when FETCH_VELOCITY_REOBSERVE is on.)
        hours_since_previous = 1.0
        engagement_delta = total_engagement
        age_hours = 0.0

    signals = FetchScoringInput(
        text=claim_text,
        engagement_delta=engagement_delta,
        hours_since_previous_observation=hours_since_previous,
        platforms_seen=platforms_seen,
        age_hours=age_hours,
    )
    score = score_candidate(signals, config=scoring_config)

    # ADR-0032 editorial-platform floor: a curated triage item can't earn the
    # velocity-weighted virality score (RSS has no engagement data), so its raw
    # score lands ~0.30-0.40 and would be dropped below tau here — which is why
    # `triage_feed` had never once emitted. Floor it to its editorial
    # provenance instead (see `_editorial_platforms`). Applied BEFORE the tau
    # gate so a curated item survives it; bounded by max_emissions_per_run, the
    # cost breaker, once-ever dedup, and the analyze hop's real claim filter.
    if candidate.platform in _editorial_platforms():
        score = max(score, _editorial_floor())

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
        # ADR-0032 §4 per-run candidate cap.
        result.capped_by_max_emissions += 1
        return

    # AT-0032-5, 80% threshold: "stops emitting new candidates while
    # dedup/trend updates continue" — the upsert_candidate call above
    # (dedup/trend bookkeeping) has already run; only this emission
    # step is skipped once soft-stopped.
    if cost_breaker is not None and cost_breaker.current_state("fetch").soft_stopped:
        result.skipped_soft_stopped += 1
        return

    submission_id = str(uuid.uuid4())
    if emit_submission is not None:
        # Real-outbox path (AT-0017-C) — see module docstring. The raw
        # engagement rides along so the emitter can compute the virality score;
        # the candidate's source url + platform ride along so the discovered
        # item is surfaceable in the trending stream before a check exists.
        submission_id = emit_submission(
            claim_text, org_id, submission_id, candidate.engagement, candidate.url, candidate.platform
        )
        analyze_result: AnalyzeResult | None = None
    else:
        request = AnalyzeHopRequest(
            submission_id=submission_id,
            org_id=org_id,
            content=HopContent(text=claim_text),
            language_hint=None,
        )
        analyze_result = await run_analyze_hop(request, llm=llm, store=idempotency_store)

    dedup_store.mark_emitted(claim_hash, submission_id=submission_id)
    if cost_breaker is not None:
        # Metered per emission (not per candidate observed) — a
        # below-tau or already-emitted candidate costs nothing against
        # the breaker, matching "stops emitting new candidates" (the
        # thing actually metered is the downstream verification pass a
        # new emission triggers, not the cheap local scoring).
        cost_breaker.record_spend("fetch", FETCH_EMISSION_ESTIMATED_USD_COST)
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
    "FETCH_EMISSION_ESTIMATED_USD_COST",
    "EmitSubmission",
    "EmittedCandidate",
    "FetchHopResult",
    "run_fetch_hop",
]
