"""ADR-0036 corroboration gate — the safety-critical ATs.

The single most important property (calibration-before-thresholds): the second
opinion contributes ZERO confidence lift until a per-stratum artifact exists AND
shadow mode is off, and NEVER moves a Tier-C named-person item to auto-publish.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.clients.corroboration_factory import GEMINI_API_KEY_ENV, make_corroboration_client
from app.eval.calibrate import (
    CalibrationArtifact,
    StratifiedCalibrationArtifact,
    write_stratified_calibration_artifact,
)
from app.fakes.fake_corroboration import FakeCorroboration
from app.models.enums import Rating
from app.models.pipeline_io import DraftVerdictOutput, VerifyResult
from app.protocols.corroboration import NO_SECOND_OPINION, CorroborationResult
from app.stages.corroboration import is_boundary_draft, run_corroboration
from app.stages.publish import finalize_publish
from app.stores.engine_breaker import InMemoryEngineCostBreaker

# TAU_A_PRE_CALIBRATION = 0.95; a Tier-A draft at 0.90 is a near-miss (boundary).
_NEAR_MISS = 0.90


def _draft(*, rating: Rating, confidence: float) -> DraftVerdictOutput:
    return DraftVerdictOutput(
        rating=rating,
        rationale="Grounded rationale text for the draft verdict under test.",
        citations=[],
        confidence=confidence,
        what_would_change_this="A primary-source correction to the underlying facts.",
        context="The claim asserts X; the sources show Y; here is the actual context.",
        language="en",
        translation_en="the claim text",
    )


def _result(draft: DraftVerdictOutput) -> VerifyResult:
    return VerifyResult(verdict=draft)


def _agree() -> CorroborationResult:
    return CorroborationResult(agreement_state="agree", second_opinion_stance="supported", model="test")


def _stratified_artifact(tmp_path: Path, *, agree_to: float, disagree_to: float) -> Path:
    """A stratified artifact whose 'agree' curve maps the near-miss UP past the
    Tier-A threshold and whose 'disagree' curve maps it DOWN."""
    path = tmp_path / "by_agreement.json"
    base = lambda to: CalibrationArtifact(
        fitted_points=[(0.0, 0.0), (_NEAR_MISS, to)], reliability_curve=[], ece=0.01, n_samples=100
    )
    write_stratified_calibration_artifact(
        StratifiedCalibrationArtifact(
            by_stratum={"agree": base(agree_to), "disagree": base(disagree_to), "baseline": base(_NEAR_MISS)}
        ),
        path,
    )
    return path


def test_activate_on_keys_no_key_returns_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(GEMINI_API_KEY_ENV, raising=False)
    assert isinstance(make_corroboration_client(), FakeCorroboration)


async def test_sampling_bound_already_above_threshold_never_calls() -> None:
    # Confidence above TAU_A_PRE -> not a boundary item -> no_second_opinion, no call.
    draft = _draft(rating=Rating.true, confidence=0.99)
    assert not is_boundary_draft(draft, named_person_involved=False, attribution="not_applicable")
    client = FakeCorroboration()
    client.seed_stance("the claim text", "supported")  # would AGREE if called
    res = await run_corroboration(
        draft=draft,
        claim_text="the claim text",
        language="en",
        named_person_involved=False,
        attribution="not_applicable",
        client=client,
    )
    assert res.agreement_state == NO_SECOND_OPINION


async def test_fail_closed_on_unseeded_fake() -> None:
    draft = _draft(rating=Rating.true, confidence=_NEAR_MISS)
    assert is_boundary_draft(draft, named_person_involved=False, attribution="not_applicable")
    res = await run_corroboration(
        draft=draft,
        claim_text="the claim text",
        language="en",
        named_person_involved=False,
        attribution="not_applicable",
        client=FakeCorroboration(),  # unseeded -> raises CorroborationError -> fail closed
    )
    assert res.agreement_state == NO_SECOND_OPINION


async def test_cost_breaker_hard_stop_skips_call() -> None:
    draft = _draft(rating=Rating.true, confidence=_NEAR_MISS)
    breaker = InMemoryEngineCostBreaker()
    breaker.record_spend("submission", 25.0)  # over the 20.0 default budget -> hard-stopped
    client = FakeCorroboration()
    client.seed_stance("the claim text", "supported")  # would AGREE if reached
    res = await run_corroboration(
        draft=draft,
        claim_text="the claim text",
        language="en",
        named_person_involved=False,
        attribution="not_applicable",
        client=client,
        breaker=breaker,
        engine="submission",
    )
    assert res.agreement_state == NO_SECOND_OPINION


async def test_agreement_derivation() -> None:
    draft = _draft(rating=Rating.true, confidence=_NEAR_MISS)  # our stance: supported
    client = FakeCorroboration()
    client.seed_stance("the claim text", "supported")
    agree = await run_corroboration(
        draft=draft, claim_text="the claim text", language="en",
        named_person_involved=False, attribution="not_applicable", client=client,
    )
    assert agree.agreement_state == "agree"

    client2 = FakeCorroboration()
    client2.seed_stance("the claim text", "refuted")
    disagree = await run_corroboration(
        draft=draft, claim_text="the claim text", language="en",
        named_person_involved=False, attribution="not_applicable", client=client2,
    )
    assert disagree.agreement_state == "disagree"


def test_shadow_mode_contributes_zero_lift(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Even with a stratified artifact that WOULD lift, shadow mode (default) keeps
    # the decision identical to no corroboration -> near-miss stays NOT auto.
    monkeypatch.delenv("CORROBORATION_SHADOW_MODE", raising=False)  # default = shadow ON
    strat = _stratified_artifact(tmp_path, agree_to=0.98, disagree_to=0.70)
    draft = _draft(rating=Rating.true, confidence=_NEAR_MISS)
    out = finalize_publish(
        _result(draft),
        named_person_involved=False,
        corroboration=_agree(),
        stratified_calibration_artifact_path=strat,
    )
    assert out.decision.auto_publish is False
    assert out.corroboration_state == "agree"  # recorded, but did not move the decision


def test_phase1_agreement_lifts_near_miss_when_released(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_SHADOW_MODE", "false")  # release the lift
    strat = _stratified_artifact(tmp_path, agree_to=0.98, disagree_to=0.70)
    draft = _draft(rating=Rating.true, confidence=_NEAR_MISS)

    agreed = finalize_publish(
        _result(draft), named_person_involved=False,
        corroboration=_agree(), stratified_calibration_artifact_path=strat,
    )
    assert agreed.decision.auto_publish is True  # 0.90 -> 0.98 > TAU_A_PRE 0.95

    disagreed = finalize_publish(
        _result(draft), named_person_involved=False,
        corroboration=CorroborationResult(agreement_state="disagree", second_opinion_stance="refuted"),
        stratified_calibration_artifact_path=strat,
    )
    assert disagreed.decision.auto_publish is False  # lowered -> stays held


def test_corroboration_never_lifts_tier_c(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # The clamp: agreement must NEVER raise a Tier-C (named-person hard-negative)
    # item's confidence. A held near-miss Tier-C (0.95, below TAU_C_MODE_A 0.99)
    # with full agreement + a lifting artifact + shadow OFF stays held — because
    # the lift is skipped for Tier C. (Whether Tier C EVER auto-publishes at all
    # is a publish-policy mode question, not corroboration's; this test isolates
    # that corroboration itself contributes nothing on Tier C.)
    monkeypatch.setenv("CORROBORATION_SHADOW_MODE", "false")
    strat = _stratified_artifact(tmp_path, agree_to=0.999, disagree_to=0.70)
    draft = _draft(rating=Rating.false, confidence=0.95)  # hard-negative + named person -> Tier C

    lifted = finalize_publish(
        _result(draft), named_person_involved=True,
        corroboration=_agree(), stratified_calibration_artifact_path=strat,
    )
    baseline = finalize_publish(_result(draft), named_person_involved=True)  # no corroboration

    assert lifted.risk_tier.value == "C"
    # Corroboration changed nothing on Tier C: same auto_publish as baseline, and
    # not auto (0.95 < 0.99), i.e. the lift to 0.999 was NOT applied.
    assert lifted.decision.auto_publish is False
    assert lifted.decision.auto_publish == baseline.decision.auto_publish
