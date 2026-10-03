from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.clients.embedder_factory import make_embedder
from app.clients.factcheck_api import make_factcheck_client
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
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.media_processing import MediaProcessingError, process_media
from app.stages.stubs import run_draft, run_extract, run_normalize, run_retrieve, run_transcribe
from app.stages.synthetic_media_triage import TriageError, run_synthetic_media_triage
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore

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
