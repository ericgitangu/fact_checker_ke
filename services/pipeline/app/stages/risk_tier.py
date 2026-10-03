"""ADR-0031: the risk-tier classifier -- the publish-policy axis.

`risk = f(names a living person?, severity of imputation [crime/
dishonesty vs inaccuracy], reach)`.

This is a PURE, rule-based function (no LLM call, no network I/O) over
fields the pipeline already produces on the wire: a claim's
`namedPerson`/`attribution` (ADR-0004, mirrored in
app/models/generated.py as `Claim.named_person`/`Claim.attribution`) and
a draft finding's imputation severity, which the draft-verdict prompt
(app/prompts/templates.py) is expected to classify alongside the rating
-- that prompt-side wiring is a follow-on to this scaffold (see the
task's delegation note: "a risk_tier classifier at draft time"); this
module is the classifier itself, independently unit-tested against its
own inputs rather than against a live LLM completion.

Tier C is reached by severity alone once a person is named -- a weaker
attribution (`unverified`) never downgrades the tier (ADR-0031 hard
constraint 2: "risk-weighting is mandatory"; a shaky quote imputing a
crime is at least as risky as a confirmed one, never less).
"""

from __future__ import annotations

from enum import StrEnum


class RiskTier(StrEnum):
    """ADR-0031 risk tiers. A (low) -> C (high, always human-gated)."""

    A = "A"
    B = "B"
    C = "C"


class ImputationSeverity(StrEnum):
    """How severe the finding's imputation is, independent of whether a
    person is named at all -- combined with `named_person` by
    `classify_risk_tier` to produce the actual tier."""

    CRIME_OR_DISHONESTY = "crime_or_dishonesty"
    INACCURACY = "inaccuracy"


def classify_risk_tier(
    *,
    named_person: bool,
    attribution: str,
    imputation_severity: ImputationSeverity,
    reach: str = "normal",
) -> RiskTier:
    """Classify a claim+finding pair into an ADR-0031 risk tier.

    `attribution` and `reach` are accepted (and reserved) for future
    refinement -- e.g. a `reach: "viral"` claim arguably deserves a
    stricter reading within the same tier -- but are NOT consulted to
    *downgrade* risk today: only `named_person` and
    `imputation_severity` currently affect the returned tier. Keeping
    them as explicit parameters (rather than omitting them) documents
    that the classifier's signature already matches the ADR's stated
    three-factor model, even though `reach` doesn't yet change the
    decision -- a deliberate, named scope limit, not an oversight.
    """
    del reach  # reserved, not yet load-bearing -- see docstring.
    if not named_person:
        return RiskTier.A
    if imputation_severity == ImputationSeverity.CRIME_OR_DISHONESTY:
        return RiskTier.C
    # Named person, but the finding is framed non-defamatorily (e.g.
    # "claim unsupported by [source]") -- ADR-0031's Tier B.
    del attribution  # see docstring: never downgrades risk.
    return RiskTier.B


__all__ = ["ImputationSeverity", "RiskTier", "classify_risk_tier"]
