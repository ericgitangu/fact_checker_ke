"""ADR-0031 follow-up: `classify_risk_tier` wired into the REAL verify ->
publish path with a REAL per-claim tier derived from the claim's own
`namedPerson`/`attribution` fields and the draft's own rating -- not the
pre-existing hardcoded `imputation_severity=INACCURACY` /
`attribution="verified"` defaults that app/stages/publish.py's
finalize_publish used to pass to classify_risk_tier regardless of what
the claim or the draft actually said (the "risk_tier is standalone +
tested but not yet wired into the verify-hop draft prompt" gap flagged in
the ADR-0031 amendment).

Covers both the pure-function proof (app.stages.risk_tier.
imputation_severity_from_rating) and the real end-to-end hop proof (a
hard-negative named-person claim really reaches Tier C through
app.stages.verify.run_verify_hop, via FakeLlmClient's new
HARD_NEGATIVE_FIXTURE_NAMED_PERSON marker -- not a hand-built
VerifyResult standing in for the hop).
"""

from __future__ import annotations

from app.clients.factcheck_api import FakeFactCheckClient
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.enums import Rating
from app.models.generated import Attribution
from app.models.hop_requests import VerifyHopRequest
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.risk_tier import ImputationSeverity, RiskTier, imputation_severity_from_rating
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore


def _request(**kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": "KNBS reports inflation at 7% in 2026."}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Pure-function unit coverage: imputation_severity_from_rating
# ---------------------------------------------------------------------------


def test_false_rating_is_crime_or_dishonesty_severity() -> None:
    assert imputation_severity_from_rating(Rating.false) == ImputationSeverity.CRIME_OR_DISHONESTY


def test_misleading_rating_is_crime_or_dishonesty_severity() -> None:
    assert imputation_severity_from_rating(Rating.misleading) == ImputationSeverity.CRIME_OR_DISHONESTY


def test_other_ratings_are_inaccuracy_severity() -> None:
    for rating in (Rating.true, Rating.mostly_true, Rating.unproven, Rating.not_checkable):
        assert imputation_severity_from_rating(rating) == ImputationSeverity.INACCURACY


def test_none_rating_is_inaccuracy_severity_never_escalated() -> None:
    # A rejected draft, or a named-person draft whose rating is withheld
    # pre-approval, must never be treated as the HIGHER severity just
    # because no rating is available.
    assert imputation_severity_from_rating(None) == ImputationSeverity.INACCURACY


# ---------------------------------------------------------------------------
# RED->GREEN: the REAL verify->publish wiring, driven through the actual
# hop (run_verify_hop), not a hand-built VerifyResult.
#
# Before this change, finalize_publish always passed the hardcoded
# ImputationSeverity.INACCURACY default to classify_risk_tier regardless
# of the draft's actual rating -- a named-person claim could never reach
# Tier C through the real hop, no matter how hard-negative the finding
# was. These assert the fixed behaviour.
# ---------------------------------------------------------------------------


async def test_named_person_hard_negative_claim_reaches_tier_c_through_real_hop() -> None:
    req = _request(
        claim_text="HARD_NEGATIVE_FIXTURE_NAMED_PERSON: the minister stole public funds.",
        named_person_involved=True,
        attribution=Attribution.confirmed,
    )

    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )

    assert result.rejected is False
    assert result.verdict is not None
    assert result.verdict.rating == Rating.false
    assert result.publish is not None
    assert result.publish.risk_tier == RiskTier.C.value


async def test_general_numeric_claim_reaches_tier_a_through_real_hop() -> None:
    # No named person at all -- the default fixture's rating (Unproven)
    # would never be hard-negative anyway, but the point of Tier A here
    # is that `named_person_involved=False` alone is dispositive,
    # independent of the draft's rating.
    req = _request()  # named_person_involved defaults to False

    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )

    assert result.rejected is False
    assert result.verdict is not None
    assert result.publish is not None
    assert result.publish.risk_tier == RiskTier.A.value


async def test_named_person_non_hard_negative_claim_stays_tier_b_through_real_hop() -> None:
    # Named person, but the fixture's default rating (Unproven) is NOT a
    # hard-negative finding -- Tier B, not C. Proves the severity
    # derivation actually discriminates on the rating rather than
    # collapsing every named-person claim to C.
    req = _request(
        claim_text="The MP attended last week's budget committee session.",
        named_person_involved=True,
        attribution=Attribution.unverified,
    )

    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )

    assert result.rejected is False
    assert result.verdict is not None
    assert result.verdict.rating == Rating.unproven
    assert result.publish is not None
    assert result.publish.risk_tier == RiskTier.B.value
