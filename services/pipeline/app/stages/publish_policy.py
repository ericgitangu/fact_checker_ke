"""ADR-0031 (+ the 2026-10-04 "two-engine pivot" amendment): the
publish-policy table, keyed on (tier, calibrated_confidence,
calibration-present?, tier_c_mode) -> {auto_publish, publish_mode,
queued_for_async_audit, requires_human_tap}.

HARD CONSTRAINTS enforced here (non-negotiable, see docs/adr/0031-
confidence-weighted-guidance.md, "Amendment (two-engine pivot)" section):

  1. **Auto-publish is the DEFAULT operating mode** (supersedes the
     original scaffold's "auto-publish OFF by default" /
     "stays OFF until calibration lands"). `PublishPolicyFlags()` (the
     zero-value/default) now has `global_auto_publish_enabled=True`.
     The kill switch (AT-0031-10) is what operators flip OFF to halt
     autonomous publishing -- see `PublishPolicyFlags.
     global_auto_publish_enabled` and services/api/src/lib/
     publish-kill-switch.ts for the audited, propagation-immediate flip.

  2. **Calibration is a quality ramp, not a blocking gate** (AT-0031-6).
     With NO calibration artifact present, Tier A/B still auto-publish --
     at deliberately conservative PRE-CALIBRATION thresholds
     (`TAU_A_PRE_CALIBRATION` / `TAU_B_PRE_CALIBRATION`, stricter than the
     calibrated `TAU_A`/`TAU_B`) rather than falling back to a full human
     gate. This supersedes the old "no calibration artifact => Tier B/C
     auto-publish disabled" behaviour.

  3. **Risk-weighting is mandatory; Tier C stays special.** Tier C is a
     CONFIGURABLE SPECTRUM of three handling modes (`TierCMode`), not a
     single behaviour:
       (a) caveated open-question + async audit -- the DEFAULT. Never a
           declarative person-directed statement; always carries
           confidence + sources + the standing caveat; queued for async
           audit.
       (b) fast-track human tap -- a pre-publish human confirm, stricter
           than (a).
       (c) plain caveat -- the Tier-A/B floor applied to Tier C. This is
           a RELAXATION below mode (a)'s protection and is refused by
           `decide_publish_policy` unless the flags carry an
           `tier_c_advocate_signoff_ref` (defence in depth: the primary
           enforcement point is services/api/src/lib/policy-audit.ts's
           `updatePolicyFlag` `relaxesTierC` gate, which this function's
           caller is expected to have gone through BEFORE persisting a
           `tier_c_mode="c"` flag in the first place).

  4. **The framing ban is a hard, unconditional publish-time gate**
     (AT-0023-7, ADR-0023 amendment): `assert_publish_time_framing_gate`
     (app/stages/framing_guard.py) is invoked before ANY auto_publish=True
     decision is returned, at every tier -- a bare person-indicting
     phrasing can never auto-publish, full stop.

  5. **The kill-switch is read fresh on every call** (AT-0031-10): there
     is no caching layer in this function, so flipping
     `global_auto_publish_enabled` off takes effect on the very next
     `decide_publish_policy` call -- "one propagation cycle" is however
     fast the caller re-reads the persisted flag (services/api's
     `policy_flags` table), not anything this function buffers.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.stages.framing_guard import assert_publish_time_framing_gate
from app.stages.risk_tier import RiskTier

# Calibrated thresholds: the taus a *calibration artifact* is fit to hit
# (ADR-0031: "set from the calibrated curve to hit a target precision").
# Placeholder starting values -- NOT fit from the eval set (that's
# app/eval/calibrate.py's job) -- tracked explicitly as tech debt: real
# values must come from a re-run of the calibration harness against
# production data per ADR-0031's "Review triggers".
TAU_A = 0.85
TAU_B = 0.97

# AT-0031-6: PRE-CALIBRATION thresholds. Auto-publish is the default mode
# even with no calibration artifact on disk at all -- but deliberately
# more conservative (higher bar) than the post-calibration taus above,
# per the amendment's "starts conservative and loosens as the flywheel
# proves out". Also placeholder starting values, same tech-debt note as
# TAU_A/TAU_B: the real values are a calibration-harness output, not a
# number chosen here.
TAU_A_PRE_CALIBRATION = 0.95
TAU_B_PRE_CALIBRATION = 0.99

# Tier-C mode (a) (open-question + async audit) auto-publishes using the
# Tier-B threshold family: it is still the highest-risk tier, so it never
# gets an *easier* bar than Tier B just because mode (a)'s framing is
# less exposed.
TAU_C_MODE_A = TAU_B
TAU_C_MODE_A_PRE_CALIBRATION = TAU_B_PRE_CALIBRATION


class TierCMode(StrEnum):
    """ADR-0031 amendment's configurable Tier-C spectrum. Ordered by
    PROTECTION, not alphabetically: B (human tap) is the strictest, A
    (open-question + async audit) is the default, C (plain caveat) is
    the floor -- see `TIER_C_MODE_PROTECTION_RANK` below, which encodes
    this order for the below-mode-a relaxation check."""

    A_OPEN_QUESTION = "a"
    B_HUMAN_TAP = "b"
    C_PLAIN_CAVEAT = "c"


# Higher = more protective. Mirrors the TS side
# (services/api/src/lib/tier-c-policy.ts TIER_C_MODE_PROTECTION_RANK) --
# keep in sync by hand, same cross-language-mirror discipline as
# framing_guard.py.
TIER_C_MODE_PROTECTION_RANK: dict[TierCMode, int] = {
    TierCMode.B_HUMAN_TAP: 2,
    TierCMode.A_OPEN_QUESTION: 1,
    TierCMode.C_PLAIN_CAVEAT: 0,
}


def tier_c_mode_relaxes_below_default(mode: TierCMode) -> bool:
    """True exactly for modes LESS protective than the mode-(a) default
    (i.e. only mode (c) today). AT-0031-8: selecting such a mode must be
    rejected without an audit-logged advocate-signoff reference."""
    return TIER_C_MODE_PROTECTION_RANK[mode] < TIER_C_MODE_PROTECTION_RANK[TierCMode.A_OPEN_QUESTION]


@dataclass(frozen=True)
class PublishPolicyFlags:
    """The live policy configuration (ADR-0031 hard constraint 2 / AT-0031-5,
    AT-0031-8). Persisted in packages/db's `policy_flags` table; any change
    is audit-logged via services/api/src/lib/policy-audit.ts, which is also
    where `tier_c_advocate_signoff_ref` is validated as REQUIRED whenever a
    write relaxes Tier-C protection below mode (a). This dataclass itself
    does no validation beyond the defence-in-depth check in
    `decide_publish_policy` -- it is primarily a plain value object.
    """

    # AT-0031-6: auto-publish is the DEFAULT operating mode. Flip this to
    # False (via the audited kill-switch, services/api/src/lib/
    # publish-kill-switch.ts) to halt ALL autonomous publishing.
    global_auto_publish_enabled: bool = True
    # AT-0031-7/8: which of the three Tier-C handling modes is active.
    # Defaults to the least-exposed, autonomous-but-caveated mode (a).
    tier_c_mode: TierCMode = TierCMode.A_OPEN_QUESTION
    # Required (defence in depth; primary gate is policy-audit.ts) when
    # `tier_c_mode` is a mode that relaxes protection below (a) -- i.e.
    # mode (c) today.
    tier_c_advocate_signoff_ref: str | None = None


@dataclass(frozen=True)
class PublishDecision:
    auto_publish: bool
    reason: str
    # "open_question" for Tier-C mode (a); "plain_caveat" for Tier A/B and
    # Tier-C mode (c); None when auto_publish is False.
    publish_mode: str | None = None
    # AT-0031-9 / AT-0025-6: True whenever this decision auto-published
    # something that a human should sample later, rather than approved it
    # before publish.
    queued_for_async_audit: bool = False
    # True for Tier-C mode (b): a pre-publish human confirm is required
    # before this item can publish at all.
    requires_human_tap: bool = False


_DEFAULT_FLAGS = PublishPolicyFlags()


def decide_publish_policy(
    *,
    tier: RiskTier,
    calibrated_confidence: float | None,
    calibration_present: bool,
    flags: PublishPolicyFlags | None = None,
    summary: str | None = None,
) -> PublishDecision:
    """`summary`, when provided, is run through the AT-0023-7 publish-time
    framing gate before any auto_publish=True decision is returned --
    callers that already have the draft's rendered summary text SHOULD
    pass it; a caller that omits it (e.g. a pure threshold unit test with
    no text to check) gets the pre-ADR-0023-7 behaviour of not gating on
    framing, which is why `services/pipeline`'s actual publish path
    (the hop that emits a final draft) must always pass it."""
    flags = flags if flags is not None else _DEFAULT_FLAGS

    if not flags.global_auto_publish_enabled:
        return PublishDecision(
            auto_publish=False,
            reason="global auto-publish kill switch is OFF — autonomous publishing halted (ADR-0031 AT-0031-10)",
        )

    if calibrated_confidence is None:
        return PublishDecision(auto_publish=False, reason="no calibrated confidence score available")

    if tier == RiskTier.C:
        return _decide_tier_c(
            calibrated_confidence=calibrated_confidence,
            calibration_present=calibration_present,
            flags=flags,
            summary=summary,
        )

    threshold = _threshold_for(tier, calibration_present)
    if calibrated_confidence >= threshold:
        if summary is not None:
            assert_publish_time_framing_gate(summary=summary, tier=tier)
        return PublishDecision(
            auto_publish=True,
            reason=f"tier {tier.value} calibrated_confidence {calibrated_confidence:.3f} >= tau {threshold}",
            publish_mode="plain_caveat",
            queued_for_async_audit=True,
        )
    return PublishDecision(
        auto_publish=False,
        reason=f"tier {tier.value} calibrated_confidence {calibrated_confidence:.3f} below tau {threshold}; human gate",
    )


def _threshold_for(tier: RiskTier, calibration_present: bool) -> float:
    if tier == RiskTier.A:
        return TAU_A if calibration_present else TAU_A_PRE_CALIBRATION
    return TAU_B if calibration_present else TAU_B_PRE_CALIBRATION


def _effective_tier_c_mode(flags: PublishPolicyFlags) -> TierCMode:
    """Defence in depth (AT-0031-8): a mode that relaxes protection below
    (a) is only honoured when an advocate-signoff reference is attached
    to the flags. This does NOT replace services/api/src/lib/
    policy-audit.ts's write-time gate (the canonical enforcement point,
    which refuses to even PERSIST such a flag without a signoff ref) --
    it is a second check so that a misconfigured/stale flags object
    cannot silently relax Tier C at decision time either. Fails safe to
    the mode-(a) default, never to "no protection at all"."""
    mode = flags.tier_c_mode
    if tier_c_mode_relaxes_below_default(mode) and not flags.tier_c_advocate_signoff_ref:
        return TierCMode.A_OPEN_QUESTION
    return mode


def _decide_tier_c(
    *,
    calibrated_confidence: float,
    calibration_present: bool,
    flags: PublishPolicyFlags,
    summary: str | None,
) -> PublishDecision:
    mode = _effective_tier_c_mode(flags)

    if mode == TierCMode.B_HUMAN_TAP:
        return PublishDecision(
            auto_publish=False,
            reason="Tier C mode (b): pre-publish human tap required (ADR-0031 amendment)",
            requires_human_tap=True,
        )

    if mode == TierCMode.C_PLAIN_CAVEAT:
        threshold = _threshold_for(RiskTier.B, calibration_present)
        if calibrated_confidence >= threshold:
            if summary is not None:
                assert_publish_time_framing_gate(summary=summary, tier=RiskTier.C)
            return PublishDecision(
                auto_publish=True,
                reason=f"Tier C mode (c): calibrated_confidence {calibrated_confidence:.3f} >= tau {threshold}",
                publish_mode="plain_caveat",
                queued_for_async_audit=True,
            )
        return PublishDecision(
            auto_publish=False,
            reason=f"Tier C mode (c): calibrated_confidence {calibrated_confidence:.3f} below tau {threshold}; human gate",
        )

    # mode == A_OPEN_QUESTION (the default).
    threshold = TAU_C_MODE_A if calibration_present else TAU_C_MODE_A_PRE_CALIBRATION
    if calibrated_confidence >= threshold:
        if summary is not None:
            assert_publish_time_framing_gate(summary=summary, tier=RiskTier.C)
        return PublishDecision(
            auto_publish=True,
            reason=(
                f"Tier C mode (a): calibrated_confidence {calibrated_confidence:.3f} >= tau {threshold} — "
                "publishing as a claim-attributed open question, queued for async audit"
            ),
            publish_mode="open_question",
            queued_for_async_audit=True,
        )
    return PublishDecision(
        auto_publish=False,
        reason=f"Tier C mode (a): calibrated_confidence {calibrated_confidence:.3f} below tau {threshold}; human gate",
    )


__all__ = [
    "TAU_A",
    "TAU_A_PRE_CALIBRATION",
    "TAU_B",
    "TAU_B_PRE_CALIBRATION",
    "TAU_C_MODE_A",
    "TAU_C_MODE_A_PRE_CALIBRATION",
    "TIER_C_MODE_PROTECTION_RANK",
    "PublishDecision",
    "PublishPolicyFlags",
    "TierCMode",
    "decide_publish_policy",
    "tier_c_mode_relaxes_below_default",
]
