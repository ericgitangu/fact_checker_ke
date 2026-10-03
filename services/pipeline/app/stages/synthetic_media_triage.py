"""Synthetic-media triage stage (ADR-0006).

Orchestrates the ADR's ordered signal list (provenance first, detector
score last/weakest) and enforces the label allowlist **in code**, not just
in a prompt or docstring: AT-0006 requires that "deepfake" never appears on
a detector score alone, so this module is the single place that produces
user-facing triage labels, and it is a closed set by construction (a
`Literal`/enum-backed `TriageLabel`), not a free-text field an LLM could
fill in with a forbidden word.

Scope note (ADR-0006's red-team amendment): detector-based triage (signal
#4) only runs on user-uploaded or owner-authorized media (ADR-0002 forbids
fetching third-party video/audio bytes) — this stage takes `media_bytes`
as a parameter precisely because the caller is responsible for having
already resolved that scope question; this module never fetches media
itself.

Rekognition/Vision are NOT called here for authenticity (ADR-0006 round-2:
"Rekognition and Vision are used only for utility jobs ... not for
authenticity") — this module has no AWS/GCP vision client dependency at
all, which is itself the enforcement of that rule (nothing to misuse).
"""

from __future__ import annotations

from enum import StrEnum

from app.protocols.provenance import ProvenanceChecker, ProvenanceCheckError
from app.protocols.reverse_image import ReverseImageSearch, ReverseImageSearchError
from app.protocols.synthetic_media import SyntheticMediaDetectionError, SyntheticMediaDetector

# Detector-score band above which triage surfaces a "signals detected"
# label rather than staying silent. Deliberately conservative (favors
# surfacing for human review over silent pass-through) and NOT tuned
# against any real-world detector's ROC curve (no real detector is wired —
# see app/protocols/synthetic_media.py) — tracked as tech debt: this
# threshold must be re-derived once a real commercial/fine-tuned detector
# is integrated (ADR-0006's review trigger: ">0.95 AUC in the wild").
DETECTOR_SIGNAL_THRESHOLD = 0.6


class TriageLabel(StrEnum):
    """The ADR-0006 label allowlist, closed by construction. "Deepfake" is
    deliberately NOT a member of this enum — there is no code path that can
    produce it from a detector score alone (AT-0006)."""

    CONTENT_CREDENTIALS_AI_GENERATED = "content credentials present/AI-generated (per C2PA)"
    EARLIER_COPY_FOUND = "earlier copy found"
    SYNTHETIC_MEDIA_SIGNALS_UNDER_REVIEW = "synthetic-media signals — under review"
    NO_SIGNAL = "no provenance/detector signal found"


class TriageError(Exception):
    """Raised for expected failure modes surfaced by any underlying
    Protocol (provenance, reverse-image, detector)."""


class TriageResult:
    __slots__ = ("detector_score", "earlier_copy_source_url", "label", "provenance_present")

    def __init__(
        self,
        *,
        label: TriageLabel,
        provenance_present: bool,
        earlier_copy_source_url: str | None,
        detector_score: float | None,
    ) -> None:
        self.label = label
        self.provenance_present = provenance_present
        self.earlier_copy_source_url = earlier_copy_source_url
        self.detector_score = detector_score


def run_synthetic_media_triage(
    media_bytes: bytes,
    *,
    mime_type: str,
    media_hash: str,
    provenance_checker: ProvenanceChecker,
    reverse_image_search: ReverseImageSearch,
    detector: SyntheticMediaDetector,
) -> TriageResult:
    """Signals, in ADR-0006 order: (1) C2PA manifest, (2) [SynthID —
    waitlist-only, not implemented, documented gap], (3) earlier-copy
    search, (4) detector score. The first signal that fires wins; a
    detector score alone only ever produces the weakest, most hedged label
    (`SYNTHETIC_MEDIA_SIGNALS_UNDER_REVIEW`), never a stronger claim.
    """
    try:
        provenance = provenance_checker.check(media_bytes, mime_type=mime_type)
    except ProvenanceCheckError as exc:
        raise TriageError(f"provenance check failed: {exc}") from exc

    if provenance.present and provenance.validated and provenance.ai_generated:
        return TriageResult(
            label=TriageLabel.CONTENT_CREDENTIALS_AI_GENERATED,
            provenance_present=True,
            earlier_copy_source_url=None,
            detector_score=None,
        )

    try:
        earlier_copy = reverse_image_search.find_earlier_copy(media_hash)
    except ReverseImageSearchError as exc:
        raise TriageError(f"reverse-image search failed: {exc}") from exc

    if earlier_copy is not None:
        return TriageResult(
            label=TriageLabel.EARLIER_COPY_FOUND,
            provenance_present=provenance.present,
            earlier_copy_source_url=earlier_copy.source_url,
            detector_score=None,
        )

    try:
        detector_score = detector.score(media_bytes, mime_type=mime_type)
    except SyntheticMediaDetectionError as exc:
        raise TriageError(f"detector scoring failed: {exc}") from exc

    if detector_score.score >= DETECTOR_SIGNAL_THRESHOLD:
        return TriageResult(
            label=TriageLabel.SYNTHETIC_MEDIA_SIGNALS_UNDER_REVIEW,
            provenance_present=provenance.present,
            earlier_copy_source_url=None,
            detector_score=detector_score.score,
        )

    return TriageResult(
        label=TriageLabel.NO_SIGNAL,
        provenance_present=provenance.present,
        earlier_copy_source_url=None,
        detector_score=detector_score.score,
    )
