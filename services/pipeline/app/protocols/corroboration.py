"""Corroboration Protocol: an INDEPENDENT second-opinion verification gate
(ADR-0036). A grounded second model (Gemini with Google Search grounding)
assesses the same claim; its AGREEMENT or disagreement with the primary
(Claude) draft is recorded as a calibration FEATURE — never blended as a raw
confidence (ADR-0031 hard constraint 1: calibration-before-thresholds).

MECHANISM NOTE: the consumer "Google AI Mode" in Search has no public API.
The programmatic equivalent is the Gemini API with Google Search *grounding*
(or Vertex AI grounding). `RealGeminiCorroboration` uses that; the only other
implementation is the deterministic `FakeCorroboration` (no network), selected
by `make_corroboration_client()` unless `GEMINI_API_KEY` is set — identical
activate-on-keys discipline to make_reverse_image_search / make_fetch_sources.

Grounding citations returned here are an AGREEMENT SIGNAL ONLY. They are NEVER
auto-ingested as citable evidence without passing the ADR-0023 §2 citation-
integrity check (the verify hop's existing path), exactly like any other
untrusted retrieved content.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

# The claim's stance in a closed 3-way space, derived from a Rating on our side
# and parsed from the grounded answer on the second model's side. Comparing two
# stances (never free text) is what yields `AgreementState`.
Stance = Literal["supported", "refuted", "inconclusive"]

# agree/disagree compare the two stances; "no_second_opinion" is the fail-closed
# / not-sampled / no-key / budget-exhausted state — it must leave the publish
# decision exactly as it would have been WITHOUT corroboration.
AgreementState = Literal["agree", "disagree", "no_second_opinion"]

NO_SECOND_OPINION: AgreementState = "no_second_opinion"


class CorroborationError(Exception):
    """Raised by a Corroboration implementation for an expected failure mode
    (backend unavailable, quota exhausted, unparseable grounded answer). The
    verify hop catches this and fails closed to `no_second_opinion` — a second
    opinion is best-effort evidence, never a hard dependency."""


@dataclass(frozen=True, slots=True)
class CorroborationResult:
    """The second gate's output, carried on the wire so services/api can persist
    the agreement feature onto the flywheel (training_eval_labels) and surface a
    transparency chip. `agreement_state` is the only field that may ever touch a
    publish decision — and only via the calibration map, never as a raw number."""

    agreement_state: AgreementState
    # The second model's own stance (for the flywheel + debugging); None when
    # no_second_opinion.
    second_opinion_stance: Stance | None = None
    model: str | None = None
    # Grounding citations (URLs). AGREEMENT SIGNAL ONLY — not citable evidence
    # until they pass ADR-0023 §2 integrity checks downstream.
    grounding_citations: list[str] = field(default_factory=list)
    usd: float = 0.0


def no_second_opinion(*, model: str | None = None) -> CorroborationResult:
    """The canonical fail-closed / not-sampled result."""
    return CorroborationResult(agreement_state=NO_SECOND_OPINION, model=model)


class Corroboration(Protocol):
    async def assess(self, *, claim_text: str, language: str) -> tuple[Stance, list[str], float]:
        """Independently assess `claim_text` against grounded web search and
        return `(stance, grounding_citation_urls, usd_cost)`.

        Must raise `CorroborationError` (not a bare exception) on any expected
        failure so the caller can fail closed to `no_second_opinion`.
        """
        ...

    async def rescue(self, *, claim_text: str, language: str) -> tuple[Stance, str, list[str], float]:
        """ADR-0036 grounded RESCUE: when the primary retrieval (Fact Check Tools
        API) returns NO sources, grounded web search assesses the claim and
        returns `(stance, assessment_text, citation_urls, usd_cost)` — a reader-
        facing sourced paragraph the verify draft can cite as evidence, so a
        claim the sparse Fact Check DB misses gets a cited verdict instead of
        dying at "inconclusive". Grounding is ALWAYS on for a rescue (it is the
        whole point). Must raise `CorroborationError` on any expected failure so
        the caller degrades to the normal no-source draft (unchanged behaviour).
        """
        ...


__all__ = [
    "NO_SECOND_OPINION",
    "AgreementState",
    "Corroboration",
    "CorroborationError",
    "CorroborationResult",
    "Stance",
    "no_second_opinion",
]
