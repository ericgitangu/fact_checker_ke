from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.clients.embedder_factory import make_embedder
from app.clients.factcheck_api import make_factcheck_client
from app.clients.fetch_source_factory import make_fetch_sources
from app.clients.llm_anthropic import make_llm_client
from app.clients.provenance_factory import make_provenance_checker
from app.config import UnpaidGeminiUsageError, assert_no_unpaid_gemini_usage
from app.fakes.fake_abuse_scan import FakeAbuseScan
from app.fakes.fake_reverse_image import FakeReverseImageSearch
from app.fakes.fake_synthetic_media import FakeSyntheticMediaDetector
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
from app.stages.media_processing import MediaProcessingError, process_media
from app.stages.stubs import run_draft, run_extract, run_normalize, run_retrieve, run_transcribe
from app.stages.synthetic_media_triage import TriageError, run_synthetic_media_triage
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore
from app.stores.fetch_dedup_memory import InMemoryFetchDedupStore

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
# ADR-0006/0027: no vendor keys wired for any of these (HARD RULE: no
# billable/live calls). _provenance_checker is the one real, local-only
# implementation (C2PA manifest parsing, no network) — see
# app/clients/provenance_factory.py. The other three stay deterministic
# fakes/heuristics by design, not by missing-credential accident; see each
# Protocol module's docstring for the "why" and the future real-vendor
# swap point.
_provenance_checker = make_provenance_checker()
_reverse_image_search = FakeReverseImageSearch()
_synthetic_media_detector = FakeSyntheticMediaDetector()
_abuse_scan = FakeAbuseScan()
# ADR-0032: the autonomous fetch engine's sources + dedup store. Sources
# activate on their own env var (YOUTUBE_API_KEY / TRIAGE_FEED_URLS);
# with neither set, every source is a FakeFetchSource and this process
# makes zero outbound fetch-source calls (AT-0032-1) — see
# app/clients/fetch_source_factory.py.
_fetch_sources = make_fetch_sources()
_fetch_dedup_store = InMemoryFetchDedupStore()
_fetch_scoring_config = FetchScoringConfig.from_env()


@app.get("/healthz")
async def healthz() -> dict[str, str]:
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


def _fetch_hop_response(result: FetchHopResult) -> FetchHopResponse:
    return FetchHopResponse(
        candidates_observed=result.candidates_observed,
        duplicate_platform_item_skipped=result.duplicate_platform_item_skipped,
        dropped_below_tau=result.dropped_below_tau,
        attached_observation_only=result.attached_observation_only,
        capped_by_max_emissions=result.capped_by_max_emissions,
        emitted_submission_ids=[e.submission_id for e in result.emitted],
    )


@app.post("/hops/fetch")
async def hop_fetch(payload: FetchHopRequest) -> FetchHopResponse:
    # ADR-0032 §4 kill-switch (AT-0032-6, partial — see app/stages/
    # fetch_hop.py's module docstring for what else AT-0032-6 covers and
    # is deferred): flipping this off stops autonomous ingestion at the
    # hop boundary. Default "true" so dev/test runs exercise the engine
    # without needing to set anything.
    if os.environ.get("FETCH_ENGINE_ENABLED", "true").lower() == "false":
        return FetchHopResponse(
            candidates_observed=0,
            duplicate_platform_item_skipped=0,
            dropped_below_tau=0,
            attached_observation_only=0,
            capped_by_max_emissions=0,
            emitted_submission_ids=[],
        )
    result = await run_fetch_hop(
        sources=_fetch_sources,
        dedup_store=_fetch_dedup_store,
        scoring_config=_fetch_scoring_config,
        llm=_haiku_llm,
        org_id=payload.org_id,
        idempotency_store=_hop_idempotency_store,
        limit_per_source=payload.limit_per_source,
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
