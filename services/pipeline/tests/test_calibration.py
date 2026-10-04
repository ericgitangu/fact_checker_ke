"""AT-0031-2: Calibration is measured on a held-out eval set (reliability
curve + ECE reported). AT-0031-9/AT-0025-7 (ADR-0031/0025 "two-engine
pivot" amendments): with no calibration artifact present, auto-publish is
still the default (at conservative pre-calibration thresholds — see
test_publish_policy.py), and the human-AUDIT sampling rate is a function
of the measured ECE, not a constant and not a gate.

Uses ONLY the committed fixtures (app/eval/fixtures/calibration.jsonl) --
no network, no live LLM call, per the task's "wire in billable surfaces
last" rule.
"""

from __future__ import annotations

from itertools import pairwise
from pathlib import Path

from app.eval.calibrate import (
    CALIBRATION_FIXTURES_PATH,
    MAX_AUDIT_SAMPLE_RATE,
    MIN_AUDIT_SAMPLE_RATE,
    PILOT_AUDIT_SAMPLE_RATE,
    CalibrationArtifact,
    apply_calibration,
    calibration_artifact_exists,
    compute_audit_sample_rate,
    fit_calibration_from_fixtures,
    load_calibration_artifact,
    write_calibration_artifact,
)
from app.stages.publish_policy import PublishPolicyFlags, TierCMode, decide_publish_policy
from app.stages.risk_tier import RiskTier

ENABLED_FLAGS = PublishPolicyFlags(global_auto_publish_enabled=True)


def test_fixtures_file_exists_and_is_nonempty() -> None:
    assert CALIBRATION_FIXTURES_PATH.exists()
    assert CALIBRATION_FIXTURES_PATH.stat().st_size > 0


def test_fit_calibration_reports_a_reliability_curve_and_ece() -> None:
    artifact = fit_calibration_from_fixtures()
    assert artifact.n_samples > 0
    assert 0.0 <= artifact.ece <= 1.0
    assert len(artifact.reliability_curve) > 0
    for bucket in artifact.reliability_curve:
        assert 0.0 <= bucket.mean_predicted_confidence <= 1.0
        assert 0.0 <= bucket.empirical_accuracy <= 1.0
        assert bucket.count >= 0


def test_isotonic_fit_is_monotonically_non_decreasing() -> None:
    # Isotonic regression's defining property: the fitted calibration
    # curve never decreases as raw confidence increases -- this is what
    # distinguishes it from simply echoing the (non-monotone, noisy) raw
    # labels back out.
    artifact = fit_calibration_from_fixtures()
    calibrated = [apply_calibration(artifact, x / 100) for x in range(0, 101, 5)]
    for prev, cur in pairwise(calibrated):
        assert cur >= prev - 1e-9


def test_write_and_load_artifact_round_trips(tmp_path: Path) -> None:
    artifact = fit_calibration_from_fixtures()
    out_path = tmp_path / "calibration.json"
    write_calibration_artifact(artifact, out_path)
    assert calibration_artifact_exists(out_path)
    loaded = load_calibration_artifact(out_path)
    assert loaded is not None
    assert loaded.n_samples == artifact.n_samples
    assert abs(loaded.ece - artifact.ece) < 1e-9


def test_at_0031_6_no_calibration_artifact_present_still_auto_publishes_at_conservative_thresholds(
    tmp_path: Path,
) -> None:
    # Supersedes the pre-amendment "Tier B/C auto-publish disabled
    # without a calibration artifact" behaviour: see app/stages/
    # publish_policy.py's TAU_*_PRE_CALIBRATION constants and
    # test_publish_policy.py's AT-0031-6 tests for the full threshold
    # coverage. This test only re-confirms the calibration-ARTIFACT side
    # of that story: a missing artifact is correctly detected as absent.
    missing_path = tmp_path / "does-not-exist.json"
    assert calibration_artifact_exists(missing_path) is False

    decision = decide_publish_policy(
        tier=RiskTier.B,
        calibrated_confidence=0.999,
        calibration_present=calibration_artifact_exists(missing_path),
        flags=ENABLED_FLAGS,
    )
    assert decision.auto_publish is True


def test_calibration_present_unblocks_tier_b_and_tier_c_mode_a_at_their_calibrated_taus(tmp_path: Path) -> None:
    artifact = fit_calibration_from_fixtures()
    out_path = tmp_path / "calibration.json"
    write_calibration_artifact(artifact, out_path)
    present = calibration_artifact_exists(out_path)
    assert present is True

    tier_b = decide_publish_policy(
        tier=RiskTier.B, calibrated_confidence=0.999, calibration_present=present, flags=ENABLED_FLAGS
    )
    assert tier_b.auto_publish is True

    # AT-0031-7: Tier C mode (a) -- the default -- also auto-publishes
    # once calibrated, unlike the pre-amendment "Tier C never auto"
    # behaviour (which is now true only of mode (b), see
    # test_publish_policy.py).
    tier_c = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=0.999,
        calibration_present=present,
        flags=ENABLED_FLAGS,
        summary="The evidence we found does not support this claim; here is why.",
    )
    assert tier_c.auto_publish is True
    assert tier_c.publish_mode == "open_question"

    # Tier C mode (b) is the one mode that stays human-gated regardless
    # of calibration.
    mode_b = decide_publish_policy(
        tier=RiskTier.C,
        calibrated_confidence=0.999,
        calibration_present=present,
        flags=PublishPolicyFlags(tier_c_mode=TierCMode.B_HUMAN_TAP),
    )
    assert mode_b.auto_publish is False
    assert mode_b.requires_human_tap is True


# ---------------------------------------------------------------------------
# AT-0031-9 / AT-0025-7: the audit sampling rate is a function of
# measured calibration, not a hardcoded constant.
# ---------------------------------------------------------------------------


def test_no_calibration_artifact_samples_everything_pilot_rate() -> None:
    assert compute_audit_sample_rate(None) == PILOT_AUDIT_SAMPLE_RATE == 1.0


def _artifact_with_ece(ece: float) -> CalibrationArtifact:
    return CalibrationArtifact(fitted_points=[(0.0, 0.0), (1.0, 1.0)], reliability_curve=[], ece=ece, n_samples=100)


def test_sample_rate_shrinks_as_calibration_improves() -> None:
    good = compute_audit_sample_rate(_artifact_with_ece(0.01))
    worse = compute_audit_sample_rate(_artifact_with_ece(0.05))
    assert MIN_AUDIT_SAMPLE_RATE <= good < worse <= MAX_AUDIT_SAMPLE_RATE


def test_sample_rate_rises_as_calibration_degrades() -> None:
    # Same function, evaluated at a later (worse) measurement -- not a
    # one-way ratchet that only ever lowers the rate.
    earlier = compute_audit_sample_rate(_artifact_with_ece(0.02))
    later_degraded = compute_audit_sample_rate(_artifact_with_ece(0.20))
    assert later_degraded > earlier


def test_perfect_calibration_hits_the_floor_not_zero() -> None:
    rate = compute_audit_sample_rate(_artifact_with_ece(0.0))
    assert rate == MIN_AUDIT_SAMPLE_RATE
    assert rate > 0.0  # the editor never stops auditing entirely


def test_very_bad_calibration_is_capped_at_the_pilot_ceiling() -> None:
    rate = compute_audit_sample_rate(_artifact_with_ece(0.9))
    assert rate == MAX_AUDIT_SAMPLE_RATE == 1.0


def test_real_fixture_calibration_yields_an_in_range_sample_rate() -> None:
    artifact = fit_calibration_from_fixtures()
    rate = compute_audit_sample_rate(artifact)
    assert MIN_AUDIT_SAMPLE_RATE <= rate <= MAX_AUDIT_SAMPLE_RATE
