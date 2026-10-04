"""AT-0032-2 (τ_fetch): score_candidate is a pure function (no LLM/
embedding call — see app/stages/fetch_scoring.py's module docstring), and
τ_fetch + every weight is env-driven CONFIG, not a constant that needs a
code change to retune."""

from __future__ import annotations

from app.stages.fetch_scoring import (
    FetchScoringConfig,
    FetchScoringInput,
    estimate_claim_density,
    score_candidate,
)


def _signals(**overrides: object) -> FetchScoringInput:
    defaults: dict[str, object] = {
        "text": "A bland caption with no numbers or claims.",
        "engagement_delta": 0.0,
        "hours_since_previous_observation": 1.0,
        "platforms_seen": frozenset({"youtube"}),
        "age_hours": 200.0,
    }
    defaults.update(overrides)
    return FetchScoringInput(**defaults)  # type: ignore[arg-type]


def test_low_signal_candidate_scores_below_default_tau() -> None:
    config = FetchScoringConfig()
    score = score_candidate(_signals(), config=config)
    assert score < config.tau_fetch


def test_high_signal_candidate_scores_above_default_tau() -> None:
    config = FetchScoringConfig()
    score = score_candidate(
        _signals(
            text="Ruto announced the Finance Bill will raise fuel tax by 10%.",
            engagement_delta=50_000.0,
            hours_since_previous_observation=1.0,
            platforms_seen=frozenset({"youtube", "triage_feed"}),
            age_hours=1.0,
        ),
        config=config,
    )
    assert score >= config.tau_fetch


def test_tau_is_config_not_code_retuning_changes_the_outcome(monkeypatch) -> None:
    # Same candidate, same score -- only τ_fetch (env) changes -- flips the
    # pass/fail outcome with zero code change (AT-0032-2's second half).
    signals = _signals(text="Just a quiet Tuesday, nothing much happening.")

    monkeypatch.setenv("FETCH_TAU", "0.0")
    lenient = FetchScoringConfig.from_env()
    assert score_candidate(signals, config=lenient) >= lenient.tau_fetch

    monkeypatch.setenv("FETCH_TAU", "0.99")
    strict = FetchScoringConfig.from_env()
    assert score_candidate(signals, config=strict) < strict.tau_fetch


def test_weights_are_env_overridable(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_WEIGHT_VELOCITY", "1")
    monkeypatch.setenv("FETCH_WEIGHT_SPREAD", "0")
    monkeypatch.setenv("FETCH_WEIGHT_CLAIM_DENSITY", "0")
    monkeypatch.setenv("FETCH_WEIGHT_RECENCY", "0")
    monkeypatch.setenv("FETCH_WEIGHT_SALIENCE", "0")

    config = FetchScoringConfig.from_env()
    assert config.weight_velocity == 1.0
    assert config.weight_spread == 0.0

    # With only velocity weighted, a zero-velocity candidate scores exactly 0
    # regardless of how claim-dense/salient/recent it is.
    score = score_candidate(
        _signals(
            text="Ruto announced the Finance Bill will raise fuel tax by 10%.",
            engagement_delta=0.0,
            age_hours=0.0,
        ),
        config=config,
    )
    assert score == 0.0


def test_salience_terms_are_env_overridable(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_SALIENCE_TERMS", "unicorn-marketplace")
    config = FetchScoringConfig.from_env()
    assert config.salience_terms == ("unicorn-marketplace",)
    # The ADR-0032 Appendix A default term "ruto" no longer matches once
    # the term list has been overridden wholesale.
    assert "ruto" not in config.salience_terms


def test_claim_density_bare_question_scores_near_zero() -> None:
    assert estimate_claim_density("Is the government doing a good job?") == 0.1


def test_claim_density_number_and_assertion_scores_highest() -> None:
    assert estimate_claim_density("The CBK said inflation hit 7% in June.") == 1.0


def test_claim_density_empty_text_scores_zero() -> None:
    assert estimate_claim_density("   ") == 0.0
