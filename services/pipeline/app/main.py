from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.stages.stubs import run_draft, run_extract, run_normalize, run_retrieve, run_transcribe

logger = logging.getLogger("fact_checker_ke.pipeline")

app = FastAPI(title="fact_checker_ke pipeline", version="0.0.0")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


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
    except Exception as exc:  # noqa: BLE001 - translate to typed HTTP error at boundary
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
