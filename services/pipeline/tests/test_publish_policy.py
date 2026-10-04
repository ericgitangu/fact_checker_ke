"""AT-0031-3/6/7/8/9/10, AT-0023-7, AT-0004-F: the publish-policy table
under the ADR-0031 "two-engine pivot" amendment (auto-publish is the
DEFAULT, Tier-C is a configurable spectrum, the editor is an async
auditor).

Supersedes the pre-amendment version of this file: the old
"no-calibration-artifact ⇒ Tier B/C auto-publish disabled" and
"kill-switch OFF by default" tests are REPLACED (not merely added to)
because the amendment explicitly flips both defaults -- see the
module docstring in app/stages/publish_policy.py.
"""

from __future__ import annotations

import pytest

from app.stages.framing_guard import FramingViolationError
from app.stages.publish_policy import (
    TAU_A,
    TAU_A_PRE_CALIBRATION,
    TAU_B,
    TAU_B_PRE_CALIBRATION,
    TAU_C_MODE_A,
    TAU_C_MODE_A_PRE_CALIBRATION,
    PublishPolicyFlags,
    TierCMode,
    decide_publish_policy,
    tier_c_mode_relaxes_below_default,
)
from app.stages.risk_tier import RiskTier

DEFAULT_FLAGS = PublishPolicyFlags()


# ---------------------------------------------------------------------------
# AT-0031-6 / hard constraint "auto-publish is the default mode"
# ---------------------------------------------------------------------------


def test_default_flags_have_auto_publish_enabled() -> None:
    # Supersedes the old "kill switch OFF by default" test: the
    # zero-value PublishPolicyFlags() now auto-publishes.
    assert DEFAULT_FLAGS.global_auto_publish_enabled is True


def test_tier_a_auto_publishes_at_or_above_tau_a_with_calibration() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.A, calibrated_confidence=TAU_A, calibration_present=True, flags=DEFAULT_FLAGS
    )
    assert decision.auto_publish is True
    assert decision.publish_mode == "plain_caveat"
    assert decision.queued_for_async_audit is True


def test_tier_a_falls_back_to_human_gate_below_tau_a_with_calibration() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.A, calibrated_confidence=TAU_A - 0.01, calibration_present=True, flags=DEFAULT_FLAGS
    )
    assert decision.auto_publish is False


def test_at_0031_6_no_calibration_artifact_still_auto_publishes_tier_a_at_conservative_threshold() -> None:
    # AT-0031-6: absence of a calibration artifact no longer falls back to
    # a full human gate -- it auto-publishes at a stricter, pre-
    # calibration threshold.
    assert TAU_A_PRE_CALIBRATION > TAU_A
    just_below_conservative = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=TAU_A_PRE_CALIBRATION - 0.01,
        calibration_present=False,
        flags=DEFAULT_FLAGS,
    )
    assert just_below_conservative.auto_publish is False

    at_conservative = decide_publish_policy(
        tier=RiskTier.A, calibrated_confidence=TAU_A_PRE_CALIBRATION, calibration_present=False, flags=DEFAULT_FLAGS
    )
    assert at_conservative.auto_publish is True
    assert at_conservative.publish_mode == "plain_caveat"


def test_at_0031_6_no_calibration_artifact_still_auto_publishes_tier_b_at_conservative_threshold() -> None:
    # This is the behaviour the amendment explicitly supersedes: the old
    # test asserted Tier B NEVER auto-published without a calibration
    # artifact, "even at confidence 0.999". Now it does, at a stricter bar.
    assert TAU_B_PRE_CALIBRATION > TAU_B
    decision = decide_publish_policy(
        tier=RiskTier.B, calibrated_confidence=TAU_B_PRE_CALIBRATION, calibration_present=False, flags=DEFAULT_FLAGS
    )
    assert decision.auto_publish is True

    decision_below = decide_publish_policy(
        tier=RiskTier.B,
        calibrated_confidence=TAU_B_PRE_CALIBRATION - 0.001,
        calibration_present=False,
        flags=DEFAULT_FLAGS,
    )
    assert decision_below.auto_publish is False


def test_tier_b_auto_publishes_at_tau_b_once_calibrated() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.B, calibrated_confidence=TAU_B, calibration_present=True, flags=DEFAULT_FLAGS
    )
    assert decision.auto_publish is True


def test_missing_confidence_never_auto_publishes() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.A, calibrated_confidence=None, calibration_present=True, flags=DEFAULT_FLAGS
    )
    assert decision.auto_publish is False


# ---------------------------------------------------------------------------
# AT-0031-10: the kill switch, read fresh every call
# ---------------------------------------------------------------------------


def test_at_0031_10_kill_switch_off_halts_auto_publish_at_every_tier() -> None:
    killed = PublishPolicyFlags(global_auto_publish_enabled=False)
    for tier in (RiskTier.A, RiskTier.B, RiskTier.C):
        decision = decide_publish_policy(
            tier=tier, calibrated_confidence=0.999, calibration_present=True, flags=killed
        )
        assert decision.auto_publish is False
        assert "kill switch" in decision.reason.lower()


def test_at_0031_10_flipping_the_flag_back_on_immediately_resumes_auto_publish() -> None:
    # No caching layer in decide_publish_policy: the very next call with
    # the flag flipped back on auto-publishes again -- this IS "one
    # propagation cycle" at this layer (the API-layer read of the
    # persisted policy_flags row is what adds real latency, and that is
    # services/api's concern, not this pure function's).
    killed = PublishPolicyFlags(global_auto_publish_enabled=False)
    resumed = PublishPolicyFlags(global_auto_publish_enabled=True)
    assert decide_publish_policy(
        tier=RiskTier.A, calibrated_confidence=TAU_A, calibration_present=True, flags=killed
    ).auto_publish is False
    assert decide_publish_policy(
        tier=RiskTier.A, calibrated_confidence=TAU_A, calibration_present=True, flags=resumed
    ).auto_publish is True


# ---------------------------------------------------------------------------
# AT-0031-7 / AT-0031-8: Tier C's configurable spectrum
# ---------------------------------------------------------------------------


def test_at_0031_7_tier_c_defaults_to_mode_a_open_question_and_async_audit() -> None:
    assert DEFAULT_FLAGS.tier_c_mode == TierCMode.A_OPEN_QUESTION
    decision = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=TAU_C_MODE_A,
        calibration_present=True,
        flags=DEFAULT_FLAGS,
        summary="The evidence we found does not support this claim about [Name]; here is why.",
    )
    assert decision.auto_publish is True
    assert decision.publish_mode == "open_question"
    assert decision.queued_for_async_audit is True
    assert decision.requires_human_tap is False


def test_at_0031_7_tier_c_mode_a_never_auto_publishes_a_bare_indictment() -> None:
    # AT-0023-7: the framing gate is unconditional, even for an otherwise
    # publishable Tier-C mode-(a) decision.
    with pytest.raises(FramingViolationError):
        decide_publish_policy(
            tier=RiskTier.C,
            calibrated_confidence=TAU_C_MODE_A,
            calibration_present=True,
            flags=DEFAULT_FLAGS,
            summary="[Name] is a liar and stole public funds.",
        )


def test_at_0031_7_tier_c_mode_a_below_threshold_falls_back_to_human_gate() -> None:
    decision = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=TAU_C_MODE_A_PRE_CALIBRATION - 0.001,
        calibration_present=False,
        flags=DEFAULT_FLAGS,
    )
    assert decision.auto_publish is False


def test_at_0031_8_tier_c_mode_b_inserts_a_pre_publish_human_tap() -> None:
    mode_b_flags = PublishPolicyFlags(tier_c_mode=TierCMode.B_HUMAN_TAP)
    decision = decide_publish_policy(
        tier=RiskTier.C, calibrated_confidence=0.999, calibration_present=True, flags=mode_b_flags
    )
    assert decision.auto_publish is False
    assert decision.requires_human_tap is True


def test_at_0031_8_mode_b_requires_no_advocate_signoff_it_is_stricter_not_a_relaxation() -> None:
    assert tier_c_mode_relaxes_below_default(TierCMode.B_HUMAN_TAP) is False
    mode_b_flags = PublishPolicyFlags(tier_c_mode=TierCMode.B_HUMAN_TAP, tier_c_advocate_signoff_ref=None)
    decision = decide_publish_policy(
        tier=RiskTier.C, calibrated_confidence=0.999, calibration_present=True, flags=mode_b_flags
    )
    assert decision.requires_human_tap is True


def test_at_0031_8_mode_c_without_advocate_signoff_falls_back_to_mode_a_defence_in_depth() -> None:
    # The PRIMARY enforcement point for this is services/api/src/lib/
    # policy-audit.ts (updatePolicyFlag's relaxesTierC gate), which
    # refuses to even persist a mode="c" flag without a signoff ref. This
    # test exercises the decision function's defence-in-depth fallback
    # for a flags object that somehow carries mode="c" anyway (e.g. a
    # stale read, a manually-constructed object in a test) -- it must
    # NOT silently relax Tier C; it falls back to the mode-(a) default.
    assert tier_c_mode_relaxes_below_default(TierCMode.C_PLAIN_CAVEAT) is True
    unsigned_relaxation = PublishPolicyFlags(tier_c_mode=TierCMode.C_PLAIN_CAVEAT, tier_c_advocate_signoff_ref=None)
    decision = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=TAU_C_MODE_A,
        calibration_present=True,
        flags=unsigned_relaxation,
        summary="The evidence we found does not support this claim; here is why.",
    )
    assert decision.auto_publish is True
    assert decision.publish_mode == "open_question"  # mode (a) behaviour, NOT plain_caveat


def test_at_0031_8_mode_c_with_advocate_signoff_behaves_as_the_tier_a_b_plain_caveat_floor() -> None:
    signed_relaxation = PublishPolicyFlags(
        tier_c_mode=TierCMode.C_PLAIN_CAVEAT,
        tier_c_advocate_signoff_ref="advocate-signoff-2026-10-04-001",
    )
    decision = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=TAU_B,
        calibration_present=True,
        flags=signed_relaxation,
        summary="The evidence we found does not support this claim; here is why.",
    )
    assert decision.auto_publish is True
    assert decision.publish_mode == "plain_caveat"


@pytest.mark.parametrize("confidence", [0.0, 0.5, TAU_B, 0.999, 1.0])
@pytest.mark.parametrize("calibration_present", [True, False])
def test_tier_c_mode_b_never_auto_publishes_regardless_of_confidence(
    confidence: float, calibration_present: bool
) -> None:
    mode_b_flags = PublishPolicyFlags(tier_c_mode=TierCMode.B_HUMAN_TAP)
    decision = decide_publish_policy(
        tier=RiskTier.C, calibrated_confidence=confidence, calibration_present=calibration_present, flags=mode_b_flags
    )
    assert decision.auto_publish is False


# ---------------------------------------------------------------------------
# AT-0023-7: the framing gate applies at every tier, not just Tier C.
# ---------------------------------------------------------------------------


def test_at_0023_7_framing_gate_blocks_tier_a_auto_publish_on_bare_indictment() -> None:
    with pytest.raises(FramingViolationError):
        decide_publish_policy(
            tier=RiskTier.A,
            calibrated_confidence=TAU_A,
            calibration_present=True,
            flags=DEFAULT_FLAGS,
            summary="[Name] committed fraud.",
        )


def test_at_0023_7_framing_gate_blocks_tier_b_auto_publish_on_bare_indictment() -> None:
    with pytest.raises(FramingViolationError):
        decide_publish_policy(
            tier=RiskTier.B,
            calibrated_confidence=TAU_B,
            calibration_present=True,
            flags=DEFAULT_FLAGS,
            summary="[Name] is guilty of bribery.",
        )


def test_at_0023_7_framing_gate_does_not_fire_when_threshold_not_met() -> None:
    # The gate only runs on the path that would otherwise auto-publish --
    # a below-threshold decision returns False without even inspecting
    # the (possibly fine) summary text.
    decision = decide_publish_policy(
        tier=RiskTier.A,
        calibrated_confidence=TAU_A - 0.5,
        calibration_present=True,
        flags=DEFAULT_FLAGS,
        summary="[Name] lied.",
    )
    assert decision.auto_publish is False


# ---------------------------------------------------------------------------
# AT-0004-F: for Tier A/B and Tier-C mode (a), auto-publish with no
# pre-publish human approval, recorded for async-audit sampling; Tier-C
# mode (b) still blocks on a human tap.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tier", "confidence"),
    [(RiskTier.A, TAU_A), (RiskTier.B, TAU_B), (RiskTier.C, TAU_C_MODE_A)],
)
def test_at_0004_f_tier_a_b_and_tier_c_mode_a_auto_publish_and_queue_for_async_audit(
    tier: RiskTier, confidence: float
) -> None:
    decision = decide_publish_policy(
        tier=tier,
        calibrated_confidence=confidence,
        calibration_present=True,
        flags=DEFAULT_FLAGS,
        summary="The evidence we found does not support this claim; here is why.",
    )
    assert decision.auto_publish is True
    assert decision.queued_for_async_audit is True
    assert decision.requires_human_tap is False


def test_at_0004_f_tier_c_mode_b_still_blocks_on_a_human_tap() -> None:
    mode_b_flags = PublishPolicyFlags(tier_c_mode=TierCMode.B_HUMAN_TAP)
    decision = decide_publish_policy(
        tier=RiskTier.C, calibrated_confidence=0.999, calibration_present=True, flags=mode_b_flags
    )
    assert decision.auto_publish is False
    assert decision.requires_human_tap is True
    assert decision.queued_for_async_audit is False
