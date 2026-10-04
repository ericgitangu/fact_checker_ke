"""ADR-0023 amendment (two-engine pivot) / AT-0023-7: the framing ban as a
PUBLISH-TIME CODE GATE, not an editor expectation.

With auto-publish as the default (ADR-0031 amendment), no human is
guaranteed to read a draft before it ships. This module is the pipeline-
side mirror of packages/core/src/schemas/guidance.ts's
`isBareIndictmentFraming` / `assertClaimAndEvidenceFraming` -- the same
narrow, rule-based lexical patterns, re-implemented in Python rather than
imported, because the pipeline (this service) and the TS API/schema
package do not share a runtime. This is a deliberate, explicit mirror
(documented here and at the TS source) rather than silent duplication:
if the TS pattern list changes, this one must change with it.

`decide_publish_policy` (app/stages/publish_policy.py) calls
`assert_publish_time_framing_gate` before returning ANY auto_publish=True
decision, at EVERY tier -- this is a hard, unconditional gate: a bare
person-indicting phrasing can never auto-publish, regardless of tier,
confidence, or Tier-C mode (AT-0023-7).
"""

from __future__ import annotations

import re

from app.stages.risk_tier import RiskTier

# Mirrors packages/core/src/schemas/guidance.ts BARE_INDICTMENT_PATTERNS
# EXACTLY (same patterns, same order) -- keep in sync by hand.
_BARE_INDICTMENT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\blied\b", re.IGNORECASE),
    re.compile(r"\bis a liar\b", re.IGNORECASE),
    re.compile(r"\bis corrupt\b", re.IGNORECASE),
    re.compile(r"\bcommitted (a |an )?(crime|fraud|bribery)\b", re.IGNORECASE),
    re.compile(r"\bis a criminal\b", re.IGNORECASE),
    re.compile(r"\bstole\b", re.IGNORECASE),
    re.compile(r"\bis guilty\b", re.IGNORECASE),
]


def is_bare_indictment_framing(summary: str) -> bool:
    return any(pattern.search(summary) for pattern in _BARE_INDICTMENT_PATTERNS)


class FramingViolationError(Exception):
    """Raised by `assert_publish_time_framing_gate` when a summary that
    would otherwise auto-publish renders a bare person-indicting verdict
    instead of claim-and-evidence (ADR-0031/ADR-0023) framing."""

    def __init__(self, summary: str, *, tier: RiskTier) -> None:
        self.summary = summary
        self.tier = tier
        super().__init__(
            f"tier {tier.value} draft renders a bare person-indicting verdict "
            f"instead of claim-and-evidence framing (ADR-0031/ADR-0023): {summary!r}"
        )


def assert_publish_time_framing_gate(*, summary: str, tier: RiskTier) -> None:
    """AT-0023-7's hard gate. Called unconditionally from
    `decide_publish_policy` before any auto-publish decision is returned
    as True -- there is no tier, confidence, or policy-flag combination
    that skips this call. Raises `FramingViolationError` (never returns a
    "soft" signal) so a caller cannot accidentally ignore the result."""
    if is_bare_indictment_framing(summary):
        raise FramingViolationError(summary, tier=tier)


__all__ = [
    "FramingViolationError",
    "assert_publish_time_framing_gate",
    "is_bare_indictment_framing",
]
