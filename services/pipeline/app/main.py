from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.clients.embedder_factory import make_embedder
from app.clients.factcheck_api import make_factcheck_client
from app.clients.llm_anthropic import make_llm_client
from app.config import UnpaidGeminiUsageError, assert_no_unpaid_gemini_usage
from app.models.hop_requests import AnalyzeHopRequest, VerifyHopRequest
from app.models.pipeline_io import AnalyzeResult, VerifyResult
from app.stages.analyze import AnalyzeHopError, run_analyze_hop
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.stubs import run_draft, run_extract, run_normalize, run_retrieve, run_transcribe
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


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/hops/analyze")
async def hop_analyze(payload: AnalyzeHopRequest) -> AnalyzeResult:
    try:
        return await run_analyze_hop(payload, llm=_haiku_llm, store=_hop_idempotency_store)
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
