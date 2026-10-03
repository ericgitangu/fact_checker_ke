"""Thin, stable re-export of the pipeline's contract enums.

`Rating` and `ClaimType` are generated from packages/core's zod schemas (the
single source of truth — see packages/core/src/schemas/rating.ts) by
`pnpm gen:contracts`, which writes app/models/generated.py. This module
re-exports them rather than redefining them so the rest of the pipeline can
keep writing `from app.models.enums import Rating` even as the generated
module's internal layout changes across regenerations.

Do not add members to `Rating` / `ClaimType` here — edit the zod enum in
packages/core and regenerate; a value added only on this side would silently
drift from the TypeScript contract, which is exactly what this generator
pipeline exists to prevent.

`PipelineStage` has no zod/core equivalent: it is an internal pipeline
concept (which processing stage produced a result), never part of the
public API or domain contract, so it is hand-written and stays here.
"""

from __future__ import annotations

from enum import StrEnum

from app.models.generated import ClaimType, Rating

__all__ = ["ClaimType", "PipelineStage", "Rating"]


class PipelineStage(StrEnum):
    NORMALIZE = "normalize"
    TRANSCRIBE = "transcribe"
    EXTRACT = "extract"
    RETRIEVE = "retrieve"
    DRAFT = "draft"
