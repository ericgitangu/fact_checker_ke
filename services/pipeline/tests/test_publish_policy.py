"""AT-0031-3: The publish-policy table auto-publishes Tier A >= tau_A,
holds Tier C for human confirm regardless of confidence.

Also exercises ADR-0031's two hard constraints directly:
  1. Calibration-before-thresholds: with no calibration artifact present,
     Tier B auto-publish is disabled (falls back to human gate) even at
     very high confidence.
  2. Risk-weighting mandatory / Tier C never auto: Tier C NEVER
     auto-publishes on model confidence alone, even at confidence 1.0,
     even with calibration present, even with every optional policy flag
     set -- there is no code path to an auto-published Tier C result.

And the global kill switch: auto-publish stays OFF by default (the
`PublishPolicyFlags()` zero-value / default-constructed flags never
auto-publish anything, regardless of tier or confidence).
"""

from __future__ import annotations

import pytest

from app.stages.publish_policy import (
    TAU_A,
    TAU_B,
    PublishPolicyFlags,
    decide_publish_policy,
)
from app.stages.risk_tier import RiskTier


def test_global_kill_switch_is_off_by_default() -> None:
    # Default-constructed flags -- nothing has explicitly turned
    # auto-publish on. Even an extremely high confidence Tier A result
    # must NOT auto-publish while this is the state.
    decision = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=0.999,
        calibration_present=True,
        flags=PublishPolicyFlags(),
    )
    assert decision.auto_publish is False


ENABLED = PublishPolicyFlags(global_auto_publish_enabled=True)


def test_tier_a_auto_publishes_at_or_above_tau_a() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=TAU_A,
        calibration_present=True,
        flags=ENABLED,
    )
    assert decision.auto_publish is True


def test_tier_a_falls_back_to_human_gate_below_tau_a() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=TAU_A - 0.01,
        calibration_present=True,
        flags=ENABLED,
    )
    assert decision.auto_publish is False


def test_tier_a_can_auto_publish_even_without_a_calibration_artifact() -> None:
    # Per the task brief's explicit hard-constraint wording: "with NO
    # calibration artifact present, Tier B and Tier C auto-publish MUST
    # be disabled" -- Tier A is not named, so it is unaffected by
    # calibration-artifact absence (it still gates on tau_A).
    decision = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=TAU_A,
        calibration_present=False,
        flags=ENABLED,
    )
    assert decision.auto_publish is True


def test_tier_b_requires_calibration_present_even_at_high_confidence() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.B,
        calibrated_confidence=0.999,
        calibration_present=False,
        flags=ENABLED,
    )
    assert decision.auto_publish is False
    assert "calibrat" in decision.reason.lower()


def test_tier_b_auto_publishes_at_tau_b_once_calibrated() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.B,
        calibrated_confidence=TAU_B,
        calibration_present=True,
        flags=ENABLED,
    )
    assert decision.auto_publish is True


@pytest.mark.parametrize("confidence", [0.0, 0.5, TAU_B, 0.999, 1.0])
@pytest.mark.parametrize("calibration_present", [True, False])
@pytest.mark.parametrize(
    "flags",
    [
        ENABLED,
        PublishPolicyFlags(
            global_auto_publish_enabled=True,
            tier_c_relaxation_enabled=True,
            tier_c_advocate_signoff_ref="advocate-signoff-2026-10-04-001",
        ),
    ],
)
def test_tier_c_never_auto_publishes_regardless_of_confidence_or_flags(
    confidence: float, calibration_present: bool, flags: PublishPolicyFlags
) -> None:
    decision = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=confidence,
        calibration_present=calibration_present,
        flags=flags,
    )
    assert decision.auto_publish is False


def test_missing_confidence_never_auto_publishes() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=None,
        calibration_present=True,
        flags=ENABLED,
    )
    assert decision.auto_publish is False
