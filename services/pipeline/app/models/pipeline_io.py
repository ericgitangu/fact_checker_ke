"""Hand-written response/IO shapes for the analyze and verify hops.

These have no packages/core equivalent (see hop_requests.py's TEMPORARY
note) — they are the pipeline's own structured-output contract for the
Haiku (analyze) and Sonnet (verify/draft) LLM calls, and are what gets
schema-validated per ADR-0023 §1 ("output is schema-validated against a
strict JSON schema; any field outside the schema ... is rejected").
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ClaimType, CredibilityTier, Rating


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
    # SEC-4 (security-hardening finding #4, 2026-10-04): true when this
    # result is the explicit "no checkable text" short-circuit for a
    # video-URL submission with no quote -- `claims` is always empty and
    # no LLM call was made. Callers (and the API's status-rendering
    # layer) must treat this as a distinct, user-facing outcome ("a quote
    # is required for video links"), not as "zero claims detected" by an
    # LLM that ran on empty input.
    needs_quote: bool = False


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
    # ADR-0034: the reader-facing context that LEADS the artifact — (a) what the
    # claim asserts, (b) how it misleads, (c) the actual context + any kernel of
    # truth — built only from retrieved sources (no new quotes; quotes go in
    # citations). Nullable so the dedup-reuse path still validates; required
    # non-empty on any rating-bearing fresh draft (enforced in verify.py) and
    # on any PUBLISHED check (CheckSchema.superRefine).
    context: str | None = Field(default=None, max_length=2000)
    language: str = Field(min_length=2, max_length=24)
    translation_en: str = Field(min_length=0, max_length=20000)


class PublishDecisionPayload(BaseModel):
    """JSON-safe mirror of app.stages.publish_policy.PublishDecision +
    app.stages.publish.PublishOutcome.risk_tier, carried on the wire so
    services/api (TS) can act on the policy decision without importing
    Python. Produced by app.stages.publish.finalize_publish, which is
    the ONE real (non-test) caller of decide_publish_policy (ADR-0031
    amendment, closing the "C1 gap")."""

    model_config = ConfigDict(extra="forbid")

    risk_tier: str
    auto_publish: bool
    reason: str
    publish_mode: str | None = None
    queued_for_async_audit: bool = False
    requires_human_tap: bool = False


class VerifyEvidence(BaseModel):
    """A citable source behind a verdict, carried on the wire so services/api
    (TS) can persist the `sources` + `check_evidence` rows a PUBLISHED Check
    is required to carry (ADR-0031 AT-0031-1 / CheckSchema.superRefine).

    Built ONLY from citations that already passed citation-integrity
    verification (ADR-0023 §2) against the retrieved set — so every item here
    is a real, quoted, non-hallucinated source. `url` is required because a
    `sources` row (and SourceSchema) requires a URL; a cited doc with no URL
    (shouldn't happen for the Fact Check Tools API) is dropped upstream rather
    than emitted here with an empty one."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=500)
    publisher: str = Field(min_length=1, max_length=200)
    credibility_tier: CredibilityTier
    quote: str = Field(min_length=1, max_length=2000)
    published_at: str | None = None


class VerifyResult(BaseModel):
    """Final /hops/verify response: the citation-checked, gated verdict."""

    model_config = ConfigDict(extra="forbid")

    verdict: DraftVerdictOutput | None
    # The citation-checked sources behind `verdict`, for services/api to
    # persist as the published Check's `evidence[]` (ADR-0031 AT-0031-1).
    # Empty for the reused-existing-check short-circuit and for a draft the
    # model declined to cite — the API's publish guard treats "no evidence"
    # as "not auto-publishable" (fail-closed, held for an editor).
    evidence: list[VerifyEvidence] = Field(default_factory=list)
    rejected: bool = False
    rejection_reason: str | None = None
    reused_existing_check: bool = False
    # The id of the prior PUBLISHED check this verdict reuses, set ONLY on the
    # `reused_existing_check=True` dedup short-circuit (run_verify_hop) so the
    # API orchestrator can point the submission at the existing check instead
    # of failing it (it reads `reused_existing_check` + this id, never treating
    # a `publish=None` reuse as a rejection). None on every non-reused return.
    reused_check_id: str | None = None
    valid_as_of: str | None = None
    usage: UsageRecord | None = None
    # None only for the `reused_existing_check=True` short-circuit in
    # run_verify_hop (that path returns a prior check's rating directly
    # and never runs a fresh publish decision) or when an exception
    # pre-empts the hop (see run_verify_hop's try/except is scoped so
    # this is populated on every non-reused, non-exceptional return,
    # including `rejected=True`, where it fail-closes to
    # auto_publish=False — see app/stages/publish.py).
    publish: PublishDecisionPayload | None = None


class MediaProcessResult(BaseModel):
    """POST /hops/media-process response (ADR-0027). Deliberately does NOT
    include the stripped media bytes: this service never re-hosts media
    (ADR-0027's "Never re-hosted" rule) — echoing processed bytes back over
    this HTTP boundary would normalize exactly the re-serving pattern the
    ADR forbids. Downstream stages that need the stripped bytes (STT,
    synthetic-media triage) consume them in-process in the same stage
    chain, not via a round-trip through this response."""

    model_config = ConfigDict(extra="forbid")

    content_hash: str
    perceptual_hash: str
    exif_gps_stripped: bool
    quarantined: bool


class SyntheticMediaTriageResult(BaseModel):
    """POST /hops/synthetic-media-triage response (ADR-0006). `label` is
    one of the closed ADR-0006 allowlist values (app/stages/
    synthetic_media_triage.py:TriageLabel) — "deepfake" is not a member of
    that enum and cannot appear here (AT-0006)."""

    model_config = ConfigDict(extra="forbid")

    label: str
    provenance_present: bool
    earlier_copy_source_url: str | None = None
    detector_score: float | None = None
