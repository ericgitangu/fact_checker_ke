"""Enums mirroring packages/core/src/schemas/rating.ts and demonstration.ts.

Keep these in lockstep with the TypeScript zod enums by hand for now — a
cross-language schema generator (e.g. zod-to-openapi + datamodel-code-generator)
is a reasonable follow-up but is YAGNI for a weekend skeleton. Flagged as
tech debt: any enum drift between here and packages/core would be a silent
contract break.
"""

from enum import StrEnum


class Rating(StrEnum):
    TRUE = "True"
    MOSTLY_TRUE = "MostlyTrue"
    MISLEADING = "Misleading"
    FALSE = "False"
    UNPROVEN = "Unproven"
    NOT_CHECKABLE = "NotCheckable"


class ClaimType(StrEnum):
    CHECKABLE = "checkable"
    OPINION = "opinion"
    PREDICTION = "prediction"
    RHETORIC = "rhetoric"


class PipelineStage(StrEnum):
    NORMALIZE = "normalize"
    TRANSCRIBE = "transcribe"
    EXTRACT = "extract"
    RETRIEVE = "retrieve"
    DRAFT = "draft"
