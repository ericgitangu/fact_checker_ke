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

from app.models.enums import Rating


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


# A draft verdict's rating counts as a "hard-negative finding" for
# ADR-0031's severity axis -- a Misleading/False rating on a named-person
# claim unavoidably imputes dishonesty, even though the rating itself
# carries no explicit severity field (see module docstring: a dedicated
# draft-prompt-side severity classification is still a follow-on; this is
# the least-speculative signal available from the wire today).
_HARD_NEGATIVE_RATINGS = frozenset({Rating.false, Rating.misleading})


def imputation_severity_from_rating(rating: Rating | None) -> ImputationSeverity:
    """Map a draft verdict's `rating` to an ADR-0031 imputation severity.

    `None` (a rejected draft, or a named-person draft whose rating is
    withheld pre-approval) is treated as the weaker INACCURACY severity,
    never CRIME_OR_DISHONESTY -- this function only escalates severity on
    a rating actually present and hard-negative; it never infers severity
    from the absence of one.
    """
    if rating in _HARD_NEGATIVE_RATINGS:
        return ImputationSeverity.CRIME_OR_DISHONESTY
    return ImputationSeverity.INACCURACY


__all__ = [
    "ImputationSeverity",
    "RiskTier",
    "classify_risk_tier",
    "imputation_severity_from_rating",
]
