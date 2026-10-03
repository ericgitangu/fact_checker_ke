"""AT-0031-2: Calibration is measured on a held-out eval set (reliability
curve + ECE reported); with no calibration artifact present, Tier B/C
auto-publish is disabled.

Uses ONLY the committed fixtures (app/eval/fixtures/calibration.jsonl) --
no network, no live LLM call, per the task's "wire in billable surfaces
last" rule.
"""

from __future__ import annotations

from itertools import pairwise
from pathlib import Path

from app.eval.calibrate import (
    CALIBRATION_FIXTURES_PATH,
    apply_calibration,
    calibration_artifact_exists,
    fit_calibration_from_fixtures,
    load_calibration_artifact,
    write_calibration_artifact,
)
from app.stages.publish_policy import PublishPolicyFlags, decide_publish_policy
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


def test_no_calibration_artifact_present_means_tier_b_and_c_auto_publish_disabled(tmp_path: Path) -> None:
    missing_path = tmp_path / "does-not-exist.json"
    assert calibration_artifact_exists(missing_path) is False

    for tier in (RiskTier.B, RiskTier.C):
        decision = decide_publish_policy(
            tier=tier,
            calibrated_confidence=0.999,
            calibration_present=calibration_artifact_exists(missing_path),
            flags=ENABLED_FLAGS,
        )
        assert decision.auto_publish is False, f"Tier {tier} must not auto-publish with no calibration artifact"


def test_calibration_present_still_leaves_tier_c_disabled_but_unblocks_tier_b(tmp_path: Path) -> None:
    artifact = fit_calibration_from_fixtures()
    out_path = tmp_path / "calibration.json"
    write_calibration_artifact(artifact, out_path)
    present = calibration_artifact_exists(out_path)
    assert present is True

    tier_b = decide_publish_policy(
        tier=RiskTier.B, calibrated_confidence=0.999, calibration_present=present, flags=ENABLED_FLAGS
    )
    assert tier_b.auto_publish is True

    tier_c = decide_publish_policy(
        tier=RiskTier.C, calibrated_confidence=0.999, calibration_present=present, flags=ENABLED_FLAGS
    )
    assert tier_c.auto_publish is False
