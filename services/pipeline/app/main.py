from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.clients.corroboration_factory import make_corroboration_client
from app.clients.embedder_factory import make_embedder
from app.clients.factcheck_api import make_factcheck_client
from app.clients.fetch_source_factory import make_fetch_sources
from app.clients.llm_anthropic import make_llm_client
from app.clients.provenance_factory import make_provenance_checker
from app.clients.reverse_image_factory import make_reverse_image_search
from app.config import UnpaidGeminiUsageError, assert_no_unpaid_gemini_usage
from app.fakes.fake_abuse_scan import FakeAbuseScan
from app.fakes.fake_synthetic_media import FakeSyntheticMediaDetector
from app.fakes.fake_transcriber import FakeTranscriber
from app.models.hop_requests import (
    AnalyzeHopEnvelope,
    MediaProcessHopRequest,
    SyntheticMediaTriageHopRequest,
    VerifyHopRequest,
)
from app.models.pipeline_io import (
    AnalyzeResult,
    MediaProcessResult,
    SyntheticMediaTriageResult,
    VerifyResult,
)
from app.stages.analyze import AnalyzeHopError, run_analyze_hop
from app.stages.fetch_hop import FetchHopResult, run_fetch_hop
from app.stages.fetch_scoring import FetchScoringConfig
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.maandamano_media_triage import (
    MediaTriageError,
    run_maandamano_media_triage,
)
from app.stages.media_processing import MediaProcessingError, process_media
from app.stages.stubs import run_draft, run_extract, run_normalize, run_retrieve, run_transcribe
from app.stages.synthetic_media_triage import TriageError, run_synthetic_media_triage
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore
from app.stores.engine_breaker import (
    EngineCostBreaker,
    InMemoryEngineCostBreaker,
    PostgresEngineCostBreaker,
)
from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore
from app.stores.fetch_dedup_postgres import PostgresFetchDedupStore
from app.stores.outbox_postgres import emit_fetch_submission_received

logger = logging.getLogger("fact_checker_ke.pipeline")


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        assert_no_unpaid_gemini_usage()
    except UnpaidGeminiUsageError:
        logger.exception("startup config assertion failed")
        raise
    yield


app = FastAPI(title="fact_checker_ke pipeline", version="0.0.0", lifespan=_lifespan)

# Module-level singletons, selected by env (real vendor if credentials are
# present, deterministic fakes otherwise) — same pattern as the existing
# stage stubs below. The real Postgres-backed CheckStore lands at wave-2
# integration (packages/db is out of scope here); this in-memory one is
# process-lifetime only, which is acceptable for a pipeline worker that is
# itself stateless/scale-to-zero between requests (tracked as tech debt,
# not silently buried — see the TEMPORARY note in app/models/hop_requests.py).
_haiku_llm = make_llm_client(is_sonnet=False)
_sonnet_llm = make_llm_client(is_sonnet=True)
_embedder = make_embedder()
_factcheck_client = make_factcheck_client()
_check_store = InMemoryCheckStore()
_hop_idempotency_store = InMemoryIdempotencyStore()
# ADR-0006/0027/0032: no vendor keys are set in this environment (HARD
# RULE: no billable/live calls), so _reverse_image_search resolves to
# FakeReverseImageSearch via make_reverse_image_search() below -- same
# env-gated selection as every other real/fake client pair in this file
# (REVERSE_IMAGE_API_KEY activates RealReverseImageSearch; see
# app/clients/reverse_image_factory.py). _provenance_checker is the one
# real, local-only implementation (C2PA manifest parsing, no network) —
# see app/clients/provenance_factory.py. _synthetic_media_detector/
# _abuse_scan stay deterministic fakes/heuristics by design, not by
# missing-credential accident; see each Protocol module's docstring for
# the "why" and the future real-vendor swap point.
_provenance_checker = make_provenance_checker()
_reverse_image_search = make_reverse_image_search()
# ADR-0036: the grounded second gate. No GEMINI_API_KEY -> FakeCorroboration ->
# the verify hop fails closed to no_second_opinion (zero effect). Activates the
# moment the owner adds the key to Secret Manager (activate-on-keys), and even
# then contributes zero confidence lift until CORROBORATION_SHADOW_MODE=false
# with a fitted per-stratum artifact present.
_corroboration_client = make_corroboration_client()
_synthetic_media_detector = FakeSyntheticMediaDetector()
_abuse_scan = FakeAbuseScan()
# ADR-0032: the autonomous fetch engine's sources + dedup store. Sources
# activate on their own env var (YOUTUBE_API_KEY / TRIAGE_FEED_URLS);
# with neither set, every source is a FakeFetchSource and this process
# makes zero outbound fetch-source calls (AT-0032-1) — see
# app/clients/fetch_source_factory.py.
_fetch_sources = make_fetch_sources()
_fetch_scoring_config = FetchScoringConfig.from_env()
# ADR-0032/0005 AT-0032-4 / AT-0005-5: no real STT vendor is wired in this
# slice (HARD RULE: no billable/live calls) -- FakeTranscriber never calls
# out, so the compliant-subset "STT allowed" path still makes zero real
# vendor calls today. The gate itself (app/stages/fetch_hop.py's
# `_resolve_claim_text`) is vendor-agnostic: swapping this singleton for a
# real Transcriber implementation later does not change the compliance
# boundary that decides WHETHER it gets called.
_transcriber = FakeTranscriber()

# ADR-0032 fetch-enactment slice (migration 0013): when a database is
# configured, the fetch engine's dedup state, outbox emission, and spend
# breaker are all REAL and Postgres-backed — closing the TECH-DEBT gaps
# both app/stores/fetch_dedup_memory.py's and the old fetch_hop.py module
# docstring flagged. With no database configured (local dev / most unit
# tests), every one of the three falls back to its process-lifetime
# in-memory/no-op equivalent — same "real vendor if credentials are
# present, deterministic fake otherwise" pattern as every other module-
# level singleton above. One connection, opened once at process start
# (same lifetime as every other singleton here) — a dropped connection
# mid-process is a known limitation of this slice (tracked as tech
# debt: a real high-traffic deployment should use a pool, e.g.
# `psycopg_pool`, and reconnect-on-error, neither of which this pass
# implements).
_fetch_db_conn = None
try:
    from app.db import database_url as _fetch_database_url

    if _fetch_database_url():
        import psycopg as _psycopg

        _fetch_db_conn = _psycopg.connect(_fetch_database_url())  # type: ignore[arg-type]
except Exception:
    logger.exception("could not open the fetch engine's Postgres connection — falling back to in-memory stores")
    _fetch_db_conn = None

_fetch_dedup_store = (
    PostgresFetchDedupStore(_fetch_db_conn) if _fetch_db_conn is not None else InMemoryFetchDedupStore()
)
_fetch_cost_breaker: EngineCostBreaker = (
    PostgresEngineCostBreaker(_fetch_db_conn) if _fetch_db_conn is not None else InMemoryEngineCostBreaker()
)


def _fetch_emit_submission(
    claim_text: str,
    org_id: str,
    submission_id: str,
    engagement: dict[str, int],
    source_url: str | None = None,
    platform: str | None = None,
) -> str:
    """The real-outbox emission strategy (AT-0017-C) — wired only when a
    database is configured; see app/stores/outbox_postgres.py. `engagement`
    (raw views/likes/comments) is carried so the emitter derives the virality
    score; `source_url` (discovered video link) and `platform` are persisted on
    the submissions row so the fetch-DISCOVERED item is surfaceable in the
    'Trending / under review' stream (GET /v1/trending)."""
    assert _fetch_db_conn is not None
    return emit_fetch_submission_received(
        _fetch_db_conn,
        org_id=org_id,
        text=claim_text,
        submission_id=submission_id,
        engagement=engagement,
        source_url=source_url,
        platform=platform,
    )


def _ensure_fetch_conn() -> None:
    """Reconnect the fetch engine's Postgres connection if it was dropped.
    The connection is a process-lifetime singleton (see the tech-debt note
    above), but the fetch schedule runs every ~30 min and Neon closes idle
    connections well before then, so by the next scheduled /hops/fetch the
    connection is reliably stale ("the connection is closed"). Probe it
    cheaply and reconnect + rebuild the stores that hold the reference. A
    no-op when the fetch engine is running on in-memory stores
    (_fetch_db_conn is None)."""
    global _fetch_db_conn, _fetch_dedup_store, _fetch_cost_breaker
    if _fetch_db_conn is None:
        return
    try:
        with _fetch_db_conn.cursor() as cur:
            cur.execute("select 1")
        return  # connection is live
    except Exception:  # noqa: BLE001 - any probe failure means the pooled conn is unusable; reconnect
        try:
            _fetch_db_conn.close()
        except Exception:  # noqa: BLE001, S110 - best-effort close of an already-broken conn
            pass
    import psycopg as _psycopg

    from app.db import database_url as _fetch_database_url

    _fetch_db_conn = _psycopg.connect(_fetch_database_url())  # type: ignore[arg-type]
    _fetch_dedup_store = PostgresFetchDedupStore(_fetch_db_conn)
    _fetch_cost_breaker = PostgresEngineCostBreaker(_fetch_db_conn)


# `/health` (NOT `/healthz`): Cloud Run's frontend intercepts any `*z` path on a
# *.run.app URL and returns a branded 404 that never reaches the container, so
# `/healthz` was unreachable in prod (see reference-cloudrun-gotchas). DB-free.
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/hops/analyze")
async def hop_analyze(event: AnalyzeHopEnvelope) -> AnalyzeResult:
    try:
        return await run_analyze_hop(
            event.to_hop_request(), llm=_haiku_llm, store=_hop_idempotency_store
        )
    except AnalyzeHopError as exc:
        logger.warning("analyze hop failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/hops/verify")
async def hop_verify(payload: VerifyHopRequest) -> VerifyResult:
    return await run_verify_hop(
        payload,
        llm=_sonnet_llm,
        embedder=_embedder,
        check_store=_check_store,
        factcheck_client=_factcheck_client,
        store=_hop_idempotency_store,
        reverse_image_search=_reverse_image_search,
        corroboration_client=_corroboration_client,
    )


class FetchHopRequest(BaseModel):
    """POST /hops/fetch request body. `org_id` is the org every emitted
    submission.received-shaped analyze call is attributed to — the real
    multi-tenant default-org resolution is services/api territory, out
    of scope here (same file-ownership boundary as the other hop
    requests above)."""

    model_config = ConfigDict(extra="forbid")

    org_id: str = Field(min_length=1)
    limit_per_source: int = Field(default=20, ge=1, le=100)


class FetchHopResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates_observed: int
    duplicate_platform_item_skipped: int
    dropped_below_tau: int
    attached_observation_only: int
    capped_by_max_emissions: int
    emitted_submission_ids: list[str]
    # AT-0032-5 observability: whether this run's emissions were
    # throttled (80%) or it never polled at all (100%, hard-stopped).
    skipped_soft_stopped: int
    hard_stopped: bool
    # AT-0032-4/AT-0005-5 observability: candidates with no claim-bearing
    # text that were blocked rather than transcribed (non-compliant
    # media, or no transcriber/audio available) -- zero STT/LLM calls
    # made for each one.
    blocked_non_compliant_media_needs_quote: int


def _fetch_hop_response(result: FetchHopResult) -> FetchHopResponse:
    return FetchHopResponse(
        candidates_observed=result.candidates_observed,
        duplicate_platform_item_skipped=result.duplicate_platform_item_skipped,
        dropped_below_tau=result.dropped_below_tau,
        attached_observation_only=result.attached_observation_only,
        capped_by_max_emissions=result.capped_by_max_emissions,
        emitted_submission_ids=[e.submission_id for e in result.emitted],
        skipped_soft_stopped=result.skipped_soft_stopped,
        hard_stopped=result.hard_stopped,
        blocked_non_compliant_media_needs_quote=result.blocked_non_compliant_media_needs_quote,
    )


@app.post("/hops/fetch")
async def hop_fetch(payload: FetchHopRequest) -> FetchHopResponse:
    # ADR-0032 §4 / AT-0032-6 kill-switch, ingestion side: flipping this
    # off stops autonomous ingestion at the hop boundary within one
    # propagation cycle (read fresh on every request — no caching).
    # Default "true" so dev/test runs exercise the engine without
    # needing to set anything. The PUBLISH side of AT-0032-6 (halting
    # autonomous publishing of already-ingested fetched items) is
    # services/api territory — see services/api/src/lib/
    # fetch-kill-switch.ts + publish-enactment.ts.
    if os.environ.get("FETCH_ENGINE_ENABLED", "true").lower() == "false":
        return FetchHopResponse(
            candidates_observed=0,
            duplicate_platform_item_skipped=0,
            dropped_below_tau=0,
            attached_observation_only=0,
            capped_by_max_emissions=0,
            emitted_submission_ids=[],
            skipped_soft_stopped=0,
            hard_stopped=False,
            blocked_non_compliant_media_needs_quote=0,
        )
    _ensure_fetch_conn()  # reconnect a Neon-dropped idle connection before use
    result = await run_fetch_hop(
        sources=_fetch_sources,
        dedup_store=_fetch_dedup_store,
        scoring_config=_fetch_scoring_config,
        llm=_haiku_llm,
        org_id=payload.org_id,
        idempotency_store=_hop_idempotency_store,
        limit_per_source=payload.limit_per_source,
        cost_breaker=_fetch_cost_breaker,
        emit_submission=_fetch_emit_submission if _fetch_db_conn is not None else None,
        transcriber=_transcriber,
    )
    return _fetch_hop_response(result)


@app.post("/hops/media-process")
async def hop_media_process(payload: MediaProcessHopRequest) -> MediaProcessResult:
    try:
        result = process_media(payload.media_base64, mime_type=payload.mime_type, abuse_scanner=_abuse_scan)
    except MediaProcessingError as exc:
        logger.warning("media-process hop failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return MediaProcessResult(
        content_hash=result.content_hash,
        perceptual_hash=result.perceptual_hash,
        exif_gps_stripped=result.exif_gps_stripped,
        quarantined=result.quarantined,
    )


@app.post("/hops/synthetic-media-triage")
async def hop_synthetic_media_triage(payload: SyntheticMediaTriageHopRequest) -> SyntheticMediaTriageResult:
    try:
        result = run_synthetic_media_triage(
            payload.media_base64,
            mime_type=payload.mime_type,
            media_hash=payload.media_hash,
            provenance_checker=_provenance_checker,
            reverse_image_search=_reverse_image_search,
            detector=_synthetic_media_detector,
        )
    except TriageError as exc:
        logger.warning("synthetic-media-triage hop failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SyntheticMediaTriageResult(
        label=result.label.value,
        provenance_present=result.provenance_present,
        earlier_copy_source_url=result.earlier_copy_source_url,
        detector_score=result.detector_score,
    )


class MaandamanoMediaTriageRequest(BaseModel):
    """ADR-0035: POST /hops/media-triage request body — the embed to
    misinfo-check. `thumbnail_ref` is the platform thumbnail/frame hash the
    reverse-image backend is queried with; NO third-party bytes are
    downloaded (ADR-0002). `platform`/`embed_url` are carried for logging
    and the write-back context only."""

    model_config = ConfigDict(extra="forbid")

    media_id: str = Field(min_length=1)
    platform: str = Field(min_length=1)
    embed_url: str = Field(min_length=1)
    thumbnail_ref: str = Field(min_length=1)


class MaandamanoMediaTriageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_id: str
    status: str
    note: str | None
    earlier_url: str | None
    # Whether the result was also written back to services/api (requires
    # API_BASE_URL + PIPELINE_CALLBACK_SECRET; the HTTP response carries the
    # result regardless, same "flip still succeeds without propagation"
    # posture as the kill-switch revalidation webhook).
    callback_delivered: bool


def _post_media_misinfo_callback(media_id: str, *, status: str, note: str | None, earlier_url: str | None) -> bool:
    """ADR-0035 step 6: write the embed's misinfo result back to the
    secret-gated API callback. Best-effort and non-throwing — a failed
    callback must not fail the hop (the embed stays `unchecked` until
    re-triaged). Fires only when both env vars are set; a no-op (returns
    False) otherwise, mirroring services/api's revalidation-webhook
    fallback. The API base URL + shared secret come from THIS service's env
    (never from the job payload) so the secret never crosses the queue."""
    import httpx

    api_base_url = os.environ.get("API_BASE_URL")
    secret = os.environ.get("PIPELINE_CALLBACK_SECRET")
    if not api_base_url or not secret:
        logger.info(
            "API_BASE_URL/PIPELINE_CALLBACK_SECRET unset — skipping the ADR-0035 misinfo write-back for "
            "media %s; the result is still returned in the hop response.",
            media_id,
        )
        return False

    url = f"{api_base_url.rstrip('/')}/v1/internal/maandamano/media/{media_id}/misinfo"
    try:
        resp = httpx.post(
            url,
            json={"status": status, "note": note, "earlierUrl": earlier_url},
            headers={"x-internal-secret": secret},
            timeout=10.0,
        )
        if resp.status_code != 200:
            logger.warning("ADR-0035 misinfo write-back for media %s returned %s", media_id, resp.status_code)
            return False
        return True
    except httpx.HTTPError as exc:
        logger.warning("ADR-0035 misinfo write-back for media %s failed: %s", media_id, exc)
        return False


@app.post("/hops/media-triage")
async def hop_media_triage(payload: MaandamanoMediaTriageRequest) -> MaandamanoMediaTriageResponse:
    try:
        result = run_maandamano_media_triage(payload.thumbnail_ref, reverse_image_search=_reverse_image_search)
    except MediaTriageError as exc:
        logger.warning("maandamano media-triage hop failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    delivered = _post_media_misinfo_callback(
        payload.media_id, status=result.status, note=result.note, earlier_url=result.earlier_url
    )
    return MaandamanoMediaTriageResponse(
        media_id=payload.media_id,
        status=result.status,
        note=result.note,
        earlier_url=result.earlier_url,
        callback_delivered=delivered,
    )


class NormalizeRequest(BaseModel):
    content: str = Field(min_length=1)


class TranscribeRequest(BaseModel):
    audio_url: str = Field(min_length=1)


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1)


class RetrieveRequest(BaseModel):
    claim_text: str = Field(min_length=1)


class DraftRequest(BaseModel):
    claim_text: str = Field(min_length=1)


@app.post("/stages/normalize")
async def stage_normalize(payload: NormalizeRequest) -> dict[str, str]:
    return await run_normalize(payload.content)


@app.post("/stages/transcribe")
async def stage_transcribe(payload: TranscribeRequest) -> dict[str, str | float]:
    try:
        return await run_transcribe(payload.audio_url)
    except Exception as exc:
        logger.warning("transcribe stage failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/stages/extract")
async def stage_extract(payload: ExtractRequest) -> dict[str, list[str]]:
    return await run_extract(payload.text)


@app.post("/stages/retrieve")
async def stage_retrieve(payload: RetrieveRequest) -> dict[str, list[str]]:
    return await run_retrieve(payload.claim_text)


@app.post("/stages/draft")
async def stage_draft(payload: DraftRequest) -> dict[str, str]:
    return await run_draft(payload.claim_text)
