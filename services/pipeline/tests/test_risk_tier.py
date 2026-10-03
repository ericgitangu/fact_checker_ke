"""ADR-0031 risk-tier classifier: a pure, rule-based function from
(names a living person?, severity of imputation, reach) -> A/B/C.

Not itself one of the five numbered ATs, but the input the policy table
(AT-0031-3) and the framing rule (AT-0031-1) both depend on, so it is
unit-tested directly and independently of the pipeline's LLM-backed
stages (the classifier takes no LLM client — pure function of claim/
finding fields already on the wire per ADR-0004: `namedPerson`,
`attribution`).
"""

from __future__ import annotations

import pytest

from app.stages.risk_tier import ImputationSeverity, RiskTier, classify_risk_tier


def test_no_named_person_is_always_tier_a() -> None:
    assert (
        classify_risk_tier(
            named_person=False,
            attribution="not_applicable",
            imputation_severity=ImputationSeverity.INACCURACY,
        )
        == RiskTier.A
    )
    # Even a (nonsensical, but defensively handled) crime/dishonesty
    # severity with no named person stays Tier A -- the risk axis is
    # about a *person* being named, not about severity alone.
    assert (
        classify_risk_tier(
            named_person=False,
            attribution="not_applicable",
            imputation_severity=ImputationSeverity.CRIME_OR_DISHONESTY,
        )
        == RiskTier.A
    )


def test_named_person_non_defamatory_finding_is_tier_b() -> None:
    assert (
        classify_risk_tier(
            named_person=True,
            attribution="confirmed",
            imputation_severity=ImputationSeverity.INACCURACY,
        )
        == RiskTier.B
    )


def test_named_person_crime_or_dishonesty_imputation_is_tier_c() -> None:
    assert (
        classify_risk_tier(
            named_person=True,
            attribution="confirmed",
            imputation_severity=ImputationSeverity.CRIME_OR_DISHONESTY,
        )
        == RiskTier.C
    )


def test_named_person_unverified_quote_crime_imputation_is_still_tier_c() -> None:
    # Weaker attribution never DOWNGRADES risk -- ADR-0031 hard constraint
    # 2 is "risk-weighting mandatory", not "risk-weighting optional when
    # the quote is shaky". An unverified quote imputing a crime is at
    # least as risky as a confirmed one.
    assert (
        classify_risk_tier(
            named_person=True,
            attribution="unverified",
            imputation_severity=ImputationSeverity.CRIME_OR_DISHONESTY,
        )
        == RiskTier.C
    )


@pytest.mark.parametrize("severity", list(ImputationSeverity))
def test_classifier_never_raises_for_any_known_severity(severity: ImputationSeverity) -> None:
    classify_risk_tier(named_person=True, attribution="confirmed", imputation_severity=severity)
