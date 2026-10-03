"""AT-0004-D / AT-0023-4: negation, number, date and entity mismatches
block claim-dedup reuse."""

from __future__ import annotations

from app.stages.dedup_guard import DedupSignals, has_negation, may_reuse


def test_negation_cue_detected_en() -> None:
    assert has_negation("The government did not raise fuel tax this year.")
    assert not has_negation("The government raised fuel tax this year.")


def test_negation_cue_detected_sw() -> None:
    assert has_negation("Serikali hakuongeza kodi ya mafuta mwaka huu.")


def test_may_reuse_blocked_by_negation_mismatch_at_0023_4() -> None:
    # AT-0023-4: "raised" vs "did not raise" must not reuse.
    allowed, reason = may_reuse(
        cosine_similarity=0.99,
        tau=0.9,
        new_text="The government did not raise fuel tax in 2026.",
        existing_text="The government raised fuel tax in 2026.",
    )
    assert allowed is False
    assert reason == "negation polarity mismatch"


def test_may_reuse_blocked_by_number_mismatch() -> None:
    allowed, reason = may_reuse(
        cosine_similarity=0.99,
        tau=0.9,
        new_text="Unemployment is at 15% this quarter.",
        existing_text="Unemployment is at 12% this quarter.",
    )
    assert allowed is False
    assert reason == "numeric value mismatch"


def test_may_reuse_blocked_by_date_mismatch_stale_statistic() -> None:
    # AT-0004-D: a true 2024 statistic should not silently answer a 2026 claim.
    allowed, reason = may_reuse(
        cosine_similarity=0.99,
        tau=0.9,
        new_text="KNBS reports inflation at 7% in 2026.",
        existing_text="KNBS reports inflation at 7% in 2024.",
    )
    assert allowed is False
    assert reason == "date mismatch"


def test_may_reuse_blocked_below_similarity_threshold() -> None:
    allowed, reason = may_reuse(
        cosine_similarity=0.5,
        tau=0.9,
        new_text="The president visited Mombasa.",
        existing_text="The president visited Mombasa.",
    )
    assert allowed is False
    assert reason == "below similarity threshold"


def test_may_reuse_allowed_when_similar_and_signals_agree() -> None:
    allowed, reason = may_reuse(
        cosine_similarity=0.95,
        tau=0.9,
        new_text="KNBS reports inflation at 7% in 2026.",
        existing_text="KNBS reports inflation at 7% in 2026.",
    )
    assert allowed is True
    assert reason is None


def test_signals_from_text_extracts_numbers_dates_entities() -> None:
    signals = DedupSignals.from_text("KNBS reports 7% inflation in 2026 for Nairobi.")
    assert "7%" in signals.numbers
    assert "2026" in signals.dates
    assert "KNBS" in signals.entities or "Nairobi" in signals.entities
