"""ADR-0036 corroboration stage: run the independent second gate ONLY on
decision-boundary drafts and turn its stance into an `AgreementState`.

Bounded by construction (the cost controls):
  1. activate-on-keys — no GEMINI_API_KEY -> FakeCorroboration -> fail-closed.
  2. boundary sampling — only Tier-A/B drafts whose confidence sits just BELOW
     the auto-publish threshold are corroborated. A draft already >= threshold
     is auto anyway; one far below can't be flipped by any plausible lift;
     Tier-C never auto-publishes, so it is never corroborated for a lift.
  3. the per-engine cost breaker (ADR-0032) — record the (estimated) spend
     BEFORE the call and skip when hard-stopped.

Fail-closed everywhere: anything unexpected -> `no_second_opinion`, which leaves
the publish decision exactly as it would have been without a second gate.
"""

from __future__ import annotations

import os

from app.models.enums import Rating
from app.models.pipeline_io import DraftVerdictOutput
from app.protocols.corroboration import (
    AgreementState,
    Corroboration,
    CorroborationError,
    CorroborationResult,
    Stance,
    no_second_opinion,
)
from app.stages.publish_policy import (
    TAU_A,
    TAU_A_PRE_CALIBRATION,
    TAU_B,
    TAU_B_PRE_CALIBRATION,
)
from app.stages.risk_tier import RiskTier, classify_risk_tier, imputation_severity_from_rating
from app.stores.engine_breaker import Engine, EngineCostBreaker

# Corroborate drafts within this much BELOW the auto threshold — the only band
# where a confidence lift from agreement could actually flip hold -> auto.
BOUNDARY_BAND = 0.10

# Pre-spend estimate (USD) charged to the cost breaker BEFORE a call. Grounding
# (Google Search tool) is materially more expensive than a plain token call
# (~$0.035/request for the search alone), so the estimate is grounding-aware:
# with the default ~$0.30/day corroboration budget that is ~7 grounded calls/day
# vs ~100 ungrounded — the daily cap is honoured in real dollars either way. The
# real post-call cost is returned in CorroborationResult.usd for reconciliation.
UNGROUNDED_CALL_USD = 0.003
GROUNDED_CALL_USD = 0.04


def _estimated_call_usd() -> float:
    grounded = os.environ.get("GEMINI_CORROBORATION_GROUNDED", "").strip().lower() == "true"
    return GROUNDED_CALL_USD if grounded else UNGROUNDED_CALL_USD


def stance_from_rating(rating: Rating | None) -> Stance:
    """Map OUR draft's Rating into the closed 3-way stance space the second
    model also reports, so agreement is a stance==stance comparison, never a
    free-text or numeric blend."""
    if rating in (Rating.true, Rating.mostly_true):
        return "supported"
    if rating in (Rating.false, Rating.misleading):
        return "refuted"
    return "inconclusive"


def _auto_threshold(tier: RiskTier, calibration_present: bool) -> float | None:
    if tier is RiskTier.A:
        return TAU_A if calibration_present else TAU_A_PRE_CALIBRATION
    if tier is RiskTier.B:
        return TAU_B if calibration_present else TAU_B_PRE_CALIBRATION
    return None  # Tier C: never auto -> never corroborated for a lift.


def is_boundary_draft(
    draft: DraftVerdictOutput,
    *,
    named_person_involved: bool,
    attribution: str,
    calibration_present: bool = False,
) -> bool:
    """True iff this draft is a Tier-A/B item whose confidence sits in
    [threshold - BOUNDARY_BAND, threshold) — the only slice a second-opinion
    lift could flip to auto-publish."""
    if draft.rating is None:
        return False
    tier = classify_risk_tier(
        named_person=named_person_involved,
        attribution=attribution,
        imputation_severity=imputation_severity_from_rating(draft.rating),
    )
    threshold = _auto_threshold(tier, calibration_present)
    if threshold is None:
        return False
    conf = draft.confidence
    return (threshold - BOUNDARY_BAND) <= conf < threshold


async def run_corroboration(
    *,
    draft: DraftVerdictOutput,
    claim_text: str,
    language: str,
    named_person_involved: bool,
    attribution: str,
    client: Corroboration,
    calibration_present: bool = False,
    breaker: EngineCostBreaker | None = None,
    engine: Engine = "corroboration",
) -> CorroborationResult:
    if not is_boundary_draft(
        draft,
        named_person_involved=named_person_involved,
        attribution=attribution,
        calibration_present=calibration_present,
    ):
        return no_second_opinion()

    # Cost breaker (pre-spend): if adding the estimated cost would hard-stop the
    # engine, do not make the call.
    if breaker is not None:
        state = breaker.record_spend(engine, _estimated_call_usd())
        if state.hard_stopped:
            return no_second_opinion()

    try:
        stance, citations, usd = await client.assess(claim_text=claim_text, language=language)
    except CorroborationError:
        # Best-effort: a flaky/unavailable second gate fails closed.
        return no_second_opinion()

    our_stance = stance_from_rating(draft.rating)
    agreement: AgreementState = "agree" if stance == our_stance else "disagree"
    return CorroborationResult(
        agreement_state=agreement,
        second_opinion_stance=stance,
        model="gemini-grounded",
        grounding_citations=citations,
        usd=usd,
    )


__all__ = [
    "BOUNDARY_BAND",
    "GROUNDED_CALL_USD",
    "UNGROUNDED_CALL_USD",
    "is_boundary_draft",
    "run_corroboration",
    "stance_from_rating",
]
