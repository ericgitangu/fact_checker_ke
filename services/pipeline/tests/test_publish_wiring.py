"""ADR-0031 amendment, C1 gap: `decide_publish_policy` wired into the REAL
verify/draft -> publish path (app.stages.publish.finalize_publish,
called from app.stages.verify.run_verify_hop), plus the explicit
fail-closed-on-missing-summary rule.

Sub-task 1 of the ADR-0032 implementation brief: "Add a RED->GREEN test
proving a bare-indictment summary never auto-publishes and a no-summary
draft never auto-publishes."
"""

from __future__ import annotations

import pytest

from app.clients.factcheck_api import FakeFactCheckClient
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.enums import Rating
from app.models.hop_requests import VerifyHopRequest
from app.models.pipeline_io import Citation, DraftVerdictOutput, VerifyResult
from app.stages.framing_guard import FramingViolationError
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.publish import finalize_publish
from app.stages.publish_policy import (
    TAU_A_PRE_CALIBRATION,
    TAU_B_PRE_CALIBRATION,
    PublishPolicyFlags,
)
from app.stages.risk_tier import RiskTier
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore


def _request(**kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": "KNBS reports inflation at 7% in 2026."}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


def _verify_result(*, rationale: str | None, rating: Rating | None = Rating.unproven, confidence: float = 0.99) -> VerifyResult:
    verdict = (
        None
        if rationale is None
        else DraftVerdictOutput(
            rating=rating,
            rationale=rationale,
            citations=[Citation(doc_id="doc-1", quoted_span="span")],
            confidence=confidence,
            what_would_change_this="new evidence",
            language="en",
            translation_en=rationale,
        )
    )
    return VerifyResult(verdict=verdict, rejected=verdict is None)


# ---------------------------------------------------------------------------
# RED->GREEN: no non-test caller of decide_publish_policy existed before
# this change. These assert the REAL wiring (finalize_publish / the
# run_verify_hop integration) now calls it and fails closed correctly.
# ---------------------------------------------------------------------------


def test_fail_closed_rejected_draft_has_no_summary_and_never_auto_publishes() -> None:
    # verdict=None (the `rejected=True` shape run_verify_hop returns after
    # two failed draft attempts) -> no rendered summary exists at all.
    result = _verify_result(rationale=None)
    outcome = finalize_publish(result, named_person_involved=False)
    assert outcome.decision.auto_publish is False
    assert "fail-closed" in outcome.decision.reason.lower()


def test_fail_closed_blank_rationale_never_auto_publishes() -> None:
    # A verdict IS present but its rationale is whitespace-only — still
    # "missing" for the fail-closed rule (never reaches
    # decide_publish_policy's auto_publish=True path even though
    # confidence is high enough that it otherwise would).
    result = _verify_result(rationale="   ", confidence=0.999)
    outcome = finalize_publish(result, named_person_involved=False)
    assert outcome.decision.auto_publish is False
    assert "fail-closed" in outcome.decision.reason.lower()


def test_bare_indictment_summary_never_auto_publishes_via_real_wiring() -> None:
    # High confidence, no missing-summary short-circuit — would otherwise
    # auto-publish at Tier A — but the rationale IS a bare indictment, so
    # the AT-0023-7 framing gate (invoked by decide_publish_policy, which
    # finalize_publish is now the real caller of) refuses it.
    result = _verify_result(rationale="[Name] stole public funds.", confidence=TAU_B_PRE_CALIBRATION)
    with pytest.raises(FramingViolationError):
        finalize_publish(result, named_person_involved=True)


def test_non_blank_summary_below_threshold_does_not_auto_publish() -> None:
    result = _verify_result(rationale="The evidence does not support this claim.", confidence=0.1)
    outcome = finalize_publish(result, named_person_involved=False)
    assert outcome.decision.auto_publish is False
    assert outcome.risk_tier == RiskTier.A


def test_non_blank_summary_above_pre_calibration_threshold_auto_publishes() -> None:
    result = _verify_result(
        rationale="The evidence we found does not support this claim; here is why.",
        confidence=TAU_A_PRE_CALIBRATION,
    )
    outcome = finalize_publish(result, named_person_involved=False, flags=PublishPolicyFlags())
    assert outcome.decision.auto_publish is True
    assert outcome.decision.queued_for_async_audit is True


async def test_real_hop_populates_publish_field_and_fails_closed_on_rejection() -> None:
    # Integration-level: drive the ACTUAL /hops/verify code path
    # (run_verify_hop), not finalize_publish directly, and confirm the
    # `publish` field it now returns is fail-closed for a rejected draft.
    req = _request(claim_text="TRIGGER_FAILURE this is not real content")
    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )
    assert result.rejected is True
    assert result.publish is not None
    assert result.publish.auto_publish is False
    assert "fail-closed" in result.publish.reason.lower()


async def test_real_hop_happy_path_populates_publish_field_below_threshold() -> None:
    # FakeLlmClient's default draft fixture is confidence=0.4, well below
    # even the pre-calibration Tier-A tau — so this is a real, non-mocked
    # trip through finalize_publish via the hop that still correctly
    # declines to auto-publish (low confidence), proving the field is
    # always populated on a non-reused result, not just on the auto-
    # publish branch.
    req = _request()
    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )
    assert result.rejected is False
    assert result.publish is not None
    assert result.publish.auto_publish is False
    assert result.publish.risk_tier == RiskTier.A.value
