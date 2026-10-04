"""Wires `decide_publish_policy` (app/stages/publish_policy.py) into the
REAL verify/draft -> publish path (ADR-0031 amendment; this closes the
"C1 gap" -- before this module, `decide_publish_policy` had no non-test
caller anywhere in the codebase).

`finalize_publish` is called from `app.stages.verify.run_verify_hop` for
every successful (non-rejected) draft, on BOTH engines (the submission
engine today, and the ADR-0032 fetch engine once it converges on this
same verify hop) -- there is exactly one publish-decision call site.

FAIL-CLOSED RULE (explicit task requirement, not in the original ADR-0031
text): if the rendered summary text is missing or empty, this module
NEVER calls into an auto-publish path -- it short-circuits to
`auto_publish=False` before `decide_publish_policy` is even invoked. This
is deliberately NOT implemented inside `decide_publish_policy` itself,
because that function's existing unit test suite
(tests/test_publish_policy.py) relies on `summary=None` meaning "skip the
framing gate" for pure-threshold tests that never had rendered text to
begin with (see that function's docstring). Enforcing fail-closed at
THIS integration boundary -- the one place that has a real rendered
draft -- gives the AT-0023-7 framing gate no path to be silently
skipped by an empty/missing summary in production, without changing the
pure policy function's already-tested contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.eval.calibrate import (
    apply_calibration,
    calibration_artifact_exists,
    load_calibration_artifact,
)
from app.models.pipeline_io import VerifyResult
from app.stages.publish_policy import PublishDecision, PublishPolicyFlags, decide_publish_policy
from app.stages.risk_tier import ImputationSeverity, RiskTier, classify_risk_tier

# Where a fitted calibration artifact would live in production. No file is
# written here by this build (no calibration harness run against
# production data yet -- see app/eval/calibrate.py's own docstring on
# this being a tech-debt placeholder) -- `calibration_present` therefore
# evaluates False today, which is the INTENDED, conservative default per
# ADR-0031 hard constraint 2 (AT-0031-6): auto-publish still runs, just at
# the stricter TAU_*_PRE_CALIBRATION thresholds.
CALIBRATION_ARTIFACT_PATH = Path(__file__).resolve().parent.parent / "data" / "calibration_artifact.json"


@dataclass(frozen=True)
class PublishOutcome:
    """The result hung off a completed /hops/verify call. `decision` is
    the actual `decide_publish_policy` return value; the three derived
    booleans mirror its fields 1:1 so API-layer callers (TS) don't need
    to re-import the Python dataclass shape -- they read the JSON hop
    response instead (see VerifyResult.publish in pipeline_io.py)."""

    risk_tier: RiskTier
    decision: PublishDecision
    summary: str | None


def _rendered_summary(verify_result: VerifyResult) -> str | None:
    """The "rendered summary" the task brief refers to: the draft
    verdict's rationale text, which is what actually gets shown to a
    reader if this auto-publishes. A rejected draft (`verdict is None`)
    or a verdict whose rationale is empty/whitespace-only both count as
    "missing" for the fail-closed rule below."""
    if verify_result.verdict is None:
        return None
    rationale = verify_result.verdict.rationale
    if rationale is None or not rationale.strip():
        return None
    return rationale


def finalize_publish(
    verify_result: VerifyResult,
    *,
    named_person_involved: bool,
    imputation_severity: ImputationSeverity = ImputationSeverity.INACCURACY,
    attribution: str = "verified",
    flags: PublishPolicyFlags | None = None,
    calibration_artifact_path: Path = CALIBRATION_ARTIFACT_PATH,
) -> PublishOutcome:
    """The ONE call site for `decide_publish_policy` in the real pipeline.
    Called by `run_verify_hop` for every successful draft -- see
    app/stages/verify.py."""
    tier = classify_risk_tier(
        named_person=named_person_involved,
        attribution=attribution,
        imputation_severity=imputation_severity,
    )

    summary = _rendered_summary(verify_result)
    if summary is None:
        # FAIL CLOSED: never reach decide_publish_policy (and therefore
        # never reach a path that could return auto_publish=True)
        # without a non-empty rendered summary for the framing gate to
        # inspect. This covers both a rejected draft (no verdict at all)
        # and the pathological case of a verdict whose rationale is
        # blank.
        return PublishOutcome(
            risk_tier=tier,
            decision=PublishDecision(
                auto_publish=False,
                reason="fail-closed: no rendered summary available to pass through the "
                "AT-0023-7 publish-time framing gate — refusing to auto-publish",
            ),
            summary=None,
        )

    calibration_present = calibration_artifact_exists(calibration_artifact_path)
    raw_confidence = verify_result.verdict.confidence if verify_result.verdict else None
    calibrated_confidence = raw_confidence
    if calibration_present and raw_confidence is not None:
        artifact = load_calibration_artifact(calibration_artifact_path)
        if artifact is not None:
            calibrated_confidence = apply_calibration(artifact, raw_confidence)

    decision = decide_publish_policy(
        tier=tier,
        calibrated_confidence=calibrated_confidence,
        calibration_present=calibration_present,
        flags=flags,
        summary=summary,
    )
    return PublishOutcome(risk_tier=tier, decision=decision, summary=summary)


__all__ = ["CALIBRATION_ARTIFACT_PATH", "PublishOutcome", "finalize_publish"]
