"""ADR-0031: the publish-policy table, keyed on
(tier, calibrated_confidence, calibration-present?) -> {auto_publish,
human_gate}.

HARD CONSTRAINTS enforced here (non-negotiable, see docs/adr/0031-
confidence-weighted-guidance.md):

  1. Calibration-before-thresholds: a confidence number may gate
     auto-publish only after it is measured-calibrated on held-out data
     (services/pipeline/app/eval/calibrate.py produces that artifact).
     With NO calibration artifact present, Tier B auto-publish is
     disabled (falls back to human gate). [see `_decide` below, the
     `tier == RiskTier.B and not calibration_present` branch]

  2. Risk-weighting is mandatory, Tier C never auto: thresholds are
     per-tier, and Tier C can NEVER drop to zero human review on model
     confidence alone. This is enforced by NOT HAVING an auto-publish
     code path for Tier C at all -- `decide_publish_policy` returns
     `auto_publish=False` unconditionally for Tier C, regardless of
     confidence or any policy flag. `PublishPolicyFlags.
     tier_c_relaxation_enabled` / `tier_c_advocate_signoff_ref` exist so
     a FUTURE, explicit, audit-logged policy decision (see
     services/api/src/lib/policy-audit.ts) can be recorded -- but this
     function deliberately does not read them to produce an auto-publish
     decision. Relaxing Tier C is a code change to this function, made
     under advocate sign-off, not a config flag this function already
     honours (ADR-0031: "keep Tier C human-gated in code").

Additionally: auto-publish stays OFF by default. `PublishPolicyFlags()`
(the zero-value/default) has `global_auto_publish_enabled=False`, so a
caller that never explicitly flips it on gets `auto_publish=False` for
every tier -- the global kill switch is off until calibration lands and
someone deliberately turns it on.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.stages.risk_tier import RiskTier

# ADR-0031: "set from the calibrated curve to hit a target precision
# (e.g. auto-publish only where calibrated P(correct) >= 0.97 for that
# tier)". These are placeholder starting values -- NOT fit from the eval
# set (that's exactly what app/eval/calibrate.py does) -- tracked
# explicitly as tech debt: the real values must come from a re-run of the
# calibration harness against production data per ADR-0031's "Review
# triggers" (eval set reaches the agreed labeled-item count).
TAU_A = 0.85
TAU_B = 0.97


@dataclass(frozen=True)
class PublishPolicyFlags:
    """The live policy configuration (ADR-0031 hard constraint 2 / AT-0031-5).

    Persisted in packages/db's `policy_flags` table; any change is
    audit-logged via services/api/src/lib/policy-audit.ts, which is also
    where `tier_c_advocate_signoff_ref` is validated as REQUIRED whenever
    `tier_c_relaxation_enabled` is set. This dataclass itself does no
    validation -- it is a plain value object; `decide_publish_policy`
    below is what actually (deliberately) ignores the Tier-C fields.
    """

    global_auto_publish_enabled: bool = False
    tier_c_relaxation_enabled: bool = False
    tier_c_advocate_signoff_ref: str | None = None


@dataclass(frozen=True)
class PublishDecision:
    auto_publish: bool
    reason: str


_DEFAULT_FLAGS = PublishPolicyFlags()


def decide_publish_policy(
    *,
    tier: RiskTier,
    calibrated_confidence: float | None,
    calibration_present: bool,
    flags: PublishPolicyFlags | None = None,
) -> PublishDecision:
    flags = flags if flags is not None else _DEFAULT_FLAGS
    if not flags.global_auto_publish_enabled:
        return PublishDecision(
            auto_publish=False,
            reason="global auto-publish kill switch is OFF (default) — scaffold only, not yet enabled",
        )

    # Hard constraint 2: Tier C NEVER auto-publishes on confidence alone.
    # No flag combination above changes this — see module docstring.
    if tier == RiskTier.C:
        return PublishDecision(
            auto_publish=False,
            reason="Tier C always requires human confirm regardless of confidence (ADR-0031 hard constraint 2)",
        )

    if calibrated_confidence is None:
        return PublishDecision(auto_publish=False, reason="no calibrated confidence score available")

    # Hard constraint 1: calibration-before-thresholds. Tier A is not
    # named in the task's "no calibration artifact ⇒ Tier B/C disabled"
    # wording, so it still gates on tau_A even pre-calibration; Tier B
    # requires a calibration artifact to exist at all.
    if tier == RiskTier.B and not calibration_present:
        return PublishDecision(
            auto_publish=False,
            reason="Tier B auto-publish requires a calibration artifact (ADR-0031 hard constraint 1)",
        )

    threshold = TAU_A if tier == RiskTier.A else TAU_B
    if calibrated_confidence >= threshold:
        return PublishDecision(
            auto_publish=True,
            reason=f"tier {tier.value} calibrated_confidence {calibrated_confidence:.3f} >= tau {threshold}",
        )
    return PublishDecision(
        auto_publish=False,
        reason=f"tier {tier.value} calibrated_confidence {calibrated_confidence:.3f} below tau {threshold}; human gate",
    )


__all__ = ["TAU_A", "TAU_B", "PublishDecision", "PublishPolicyFlags", "decide_publish_policy"]
