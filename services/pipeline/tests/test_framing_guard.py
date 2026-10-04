"""AT-0023-7: the framing ban as a publish-time code gate. Mirrors
packages/core/src/__tests__/guidance.test.ts's bare-indictment cases on
the Python side."""

from __future__ import annotations

import pytest

from app.stages.framing_guard import (
    FramingViolationError,
    assert_publish_time_framing_gate,
    is_bare_indictment_framing,
)
from app.stages.risk_tier import RiskTier


@pytest.mark.parametrize(
    "summary",
    [
        "[Name] lied about the figures.",
        "The minister is a liar.",
        "The agency is corrupt.",
        "He committed fraud against the fund.",
        "She committed a crime.",
        "The official is a criminal.",
        "They stole public funds.",
        "The defendant is guilty.",
    ],
)
def test_is_bare_indictment_framing_true_for_indicting_phrasing(summary: str) -> None:
    assert is_bare_indictment_framing(summary) is True


@pytest.mark.parametrize(
    "summary",
    [
        "The evidence we found does not support this claim about the minister.",
        "Here is what would change this assessment: a verifiable receipt.",
        "The claim is unproven based on the sources we reviewed.",
    ],
)
def test_is_bare_indictment_framing_false_for_claim_and_evidence_phrasing(summary: str) -> None:
    assert is_bare_indictment_framing(summary) is False


def test_assert_publish_time_framing_gate_raises_on_violation() -> None:
    with pytest.raises(FramingViolationError) as exc_info:
        assert_publish_time_framing_gate(summary="[Name] stole the money.", tier=RiskTier.C)
    assert exc_info.value.tier == RiskTier.C


def test_assert_publish_time_framing_gate_passes_silently_otherwise() -> None:
    assert_publish_time_framing_gate(
        summary="The evidence we found does not support this claim.", tier=RiskTier.A
    )
