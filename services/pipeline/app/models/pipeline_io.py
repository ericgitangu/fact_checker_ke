"""Hand-written response/IO shapes for the analyze and verify hops.

These have no packages/core equivalent (see hop_requests.py's TEMPORARY
note) — they are the pipeline's own structured-output contract for the
Haiku (analyze) and Sonnet (verify/draft) LLM calls, and are what gets
schema-validated per ADR-0023 §1 ("output is schema-validated against a
strict JSON schema; any field outside the schema ... is rejected").
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ClaimType, Rating


class UsageRecord(BaseModel):
    """Per-call cost telemetry (ADR-0011 §7): `{stage, model, input_tokens,
    cached_tokens, output_tokens, usd}`. Returned in the hop response for
    the API to persist to Postgres — this service never writes to Neon
    directly (file-ownership boundary, see task brief)."""

    model_config = ConfigDict(extra="forbid")

    stage: str
    model: str
    input_tokens: int = Field(ge=0)
    cached_tokens: int = Field(ge=0, default=0)
    output_tokens: int = Field(ge=0)
    usd: float = Field(ge=0)


class DetectedClaim(BaseModel):
    """One statement classified by the analyze hop."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=2000)
    claim_type: ClaimType
    # Sampling gate (ADR-0004 AT-0004-E / ADR-0023 §5): at least 10% of
    # dropped (non-checkable) items are flagged for editor review so a
    # misclassification doesn't silently vanish.
    sampled_for_editor_review: bool = False


class AnalyzeResult(BaseModel):
    """Structured output of the single analyze-hop LLM call: language-ID +
    claim detection + inline EN working translation (ADR-0005 ASR/
    translation amendments)."""

    model_config = ConfigDict(extra="forbid")

    language: str = Field(min_length=2, max_length=24)
    translation_en: str = Field(min_length=0, max_length=20000)
    claims: list[DetectedClaim] = Field(default_factory=list)
    # ADR-0004 amendment #6: for a video-URL submission, the quote passes
    # through untouched with this set to "unverified"; otherwise None.
    attribution: str | None = None
    usage: UsageRecord


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc_id: str = Field(min_length=1)
    quoted_span: str = Field(min_length=1, max_length=2000)


class DraftVerdictOutput(BaseModel):
    """Raw structured output straight off the LLM, before citation-integrity
    verification (ADR-0023 §1/§2) is applied. `rating` is nullable because a
    named-person draft must render evidence/sources only, `rating: null`,
    until an editor approves it (ADR-0004 amendment #5)."""

    model_config = ConfigDict(extra="forbid")

    rating: Rating | None
    rationale: str = Field(min_length=1, max_length=4000)
    citations: list[Citation] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    what_would_change_this: str = Field(min_length=1, max_length=2000)
    language: str = Field(min_length=2, max_length=24)
    translation_en: str = Field(min_length=0, max_length=20000)


class VerifyResult(BaseModel):
    """Final /hops/verify response: the citation-checked, gated verdict."""

    model_config = ConfigDict(extra="forbid")

    verdict: DraftVerdictOutput | None
    rejected: bool = False
    rejection_reason: str | None = None
    reused_existing_check: bool = False
    valid_as_of: str | None = None
    usage: UsageRecord | None = None
