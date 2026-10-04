"""Pipeline-local QStash hop request models.

# RECONCILED (2026-10-03): /hops/analyze now accepts the canonical
# submission.received event envelope (ADR-0017) via AnalyzeHopEnvelope below;
# AnalyzeHopRequest/HopContent remain the internal shape run_analyze_hop uses.

ADR-0017 defines the cross-service event envelope
(`{event_id, occurred_at, submission_id, org_id, schema_version}`) and its
payload schemas live in packages/core, owned by the wave-2 integrator who is
defining the real `submission.analyzed.v1` / `check.drafted.v1` contracts
concurrently with this change. This module is a deliberately minimal,
pipeline-local stand-in so `/hops/analyze` and `/hops/verify` have a typed
request shape to develop and test against *today*, without reaching into
packages/core (out of scope per this change's file ownership) or guessing at
the integrator's eventual envelope.

Kept intentionally small: {submission_id, org_id, content, language_hint}.
The integrator reconciles this with the real event payload shape at
integration time — expect this file to be deleted or rewritten then.
"""

from __future__ import annotations

from pydantic import Base64Bytes, BaseModel, ConfigDict, Field, model_validator


class HopContent(BaseModel):
    """Exactly one of `url` / `text` must be present, mirroring
    SubmissionInput's zod refinement (see app/models/domain.py). `quote` +
    `timestamp_sec` only apply to a `url` submission (ADR-0004 amendment #6:
    for a video URL, the input IS the user's quote, carried through with
    `attribution: unverified`, never a fabricated transcript).
    """

    model_config = ConfigDict(extra="forbid")

    url: str | None = None
    text: str | None = Field(default=None, min_length=1, max_length=20000)
    quote: str | None = Field(default=None, min_length=1, max_length=5000)
    timestamp_sec: int | None = Field(default=None, ge=0, le=86400)

    @model_validator(mode="after")
    def _check_exactly_one_of_url_or_text(self) -> HopContent:
        if bool(self.url) == bool(self.text):
            raise ValueError("Provide exactly one of `url` or `text`.")
        if self.text and (self.quote or self.timestamp_sec is not None):
            raise ValueError("`quote`/`timestamp_sec` only apply to `url` content.")
        return self

    @property
    def is_video_url_submission(self) -> bool:
        """True when this is a third-party video URL submission: the quote
        IS the input (ADR-0004 amendment #6), never a transcript."""
        return self.url is not None


class AnalyzeHopRequest(BaseModel):
    """POST /hops/analyze request body. # TEMPORARY, see module docstring."""

    model_config = ConfigDict(extra="forbid")

    submission_id: str = Field(min_length=1)
    org_id: str = Field(min_length=1)
    content: HopContent
    language_hint: str | None = None


class SubmissionReceivedPayload(BaseModel):
    """The `payload` of a submission.received event (packages/core
    SubmissionReceivedEventSchema). `extra="ignore"` so a future payload
    field doesn't 422 the hop."""

    model_config = ConfigDict(extra="ignore")

    url: str | None = None
    text: str | None = None
    submitted_by: str | None = None
    quote: str | None = None
    timestamp_sec: int | None = None
    # ADR-0032 provenance (packages/core SubmissionReceivedEventSchema's
    # new `ingest_source` field, additive/defaulted there too): carried
    # through for completeness, not yet consumed by run_analyze_hop
    # itself (API-side persistence/attribution of fetch-sourced
    # submissions is a later-wave concern — see app/stages/fetch_hop.py's
    # module docstring).
    ingest_source: str = "submission"


class AnalyzeHopEnvelope(BaseModel):
    """POST /hops/analyze body: the canonical submission.received event
    (ADR-0017). The outbox relay posts the whole OutboxEvent; we accept it and
    IGNORE envelope metadata (event_id/occurred_at/event_type/schema_version)
    we don't need, then map payload -> AnalyzeHopRequest. Fixes the
    envelope-vs-hop-shape 422 (code-review blocker #1)."""

    model_config = ConfigDict(extra="ignore")

    submission_id: str = Field(min_length=1)
    org_id: str = Field(min_length=1)
    payload: SubmissionReceivedPayload

    def to_hop_request(self) -> AnalyzeHopRequest:
        return AnalyzeHopRequest(
            submission_id=self.submission_id,
            org_id=self.org_id,
            content=HopContent(
                url=self.payload.url,
                text=self.payload.text,
                quote=self.payload.quote,
                timestamp_sec=self.payload.timestamp_sec,
            ),
            language_hint=None,
        )


class VerifyHopRequest(BaseModel):
    """POST /hops/verify request body. # TEMPORARY, see module docstring."""

    model_config = ConfigDict(extra="forbid")

    submission_id: str = Field(min_length=1)
    org_id: str = Field(min_length=1)
    claim_text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", min_length=2, max_length=16)
    named_person_involved: bool = False


class MediaProcessHopRequest(BaseModel):
    """POST /hops/media-process request body (ADR-0027).

    `media_base64` carries already-uploaded media bytes for processing in
    this call only (ADR-0027's post-upload stage this service owns) — the
    signed-GCS-upload mechanics that got the bytes here are a
    services/api + apps/web concern, out of scope. # TEMPORARY, see module
    docstring (same TEMPORARY-pending-wave-2-reconciliation status as the
    analyze/verify hop requests above).
    """

    model_config = ConfigDict(extra="forbid")

    submission_id: str = Field(min_length=1)
    org_id: str = Field(min_length=1)
    media_base64: Base64Bytes
    mime_type: str = Field(min_length=1, max_length=100)


class SyntheticMediaTriageHopRequest(BaseModel):
    """POST /hops/synthetic-media-triage request body (ADR-0006).

    Scope note (ADR-0006 red-team amendment): detector-based triage only
    runs on media the caller has already resolved as upload-only or
    owner-authorized (ADR-0002 forbids fetching third-party video/audio
    bytes) — this request model takes raw bytes precisely because that
    scoping decision has already been made by the caller.
    """

    model_config = ConfigDict(extra="forbid")

    submission_id: str = Field(min_length=1)
    org_id: str = Field(min_length=1)
    media_base64: Base64Bytes
    mime_type: str = Field(min_length=1, max_length=100)
    media_hash: str = Field(min_length=1)
