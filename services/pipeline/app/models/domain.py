"""Pydantic v2 models mirroring packages/core/src/schemas/*.ts.

These are the pipeline-internal shapes exchanged between stages; services/api
is the system of record for the public API shapes. See the module docstring
in enums.py for the hand-sync caveat.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ClaimType, Rating


class Claim(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    check_id: str
    text: str = Field(min_length=1, max_length=2000)
    claim_type: ClaimType
    span_start: int | None = Field(default=None, ge=0)
    span_end: int | None = Field(default=None, ge=0)


class Source(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    url: str
    title: str
    publisher: str
    credibility_tier: str
    retrieved_at: datetime


class DraftVerdict(BaseModel):
    model_config = ConfigDict(strict=True)

    summary: str = Field(min_length=1, max_length=4000)
    rating: Rating | None = None
    claims: list[Claim] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
