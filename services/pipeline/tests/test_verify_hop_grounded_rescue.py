"""ADR-0036 grounded RESCUE wired into the REAL /hops/verify path.

When the Fact Check Tools API returns NO sources (the sparse-retrieval case
that leaves most claims "inconclusive" and held), the grounded Gemini gate
supplies a sourced assessment the draft can cite — so the claim gets a real,
cited verdict instead of dying at no-source. Drives the real hop end-to-end
(FakeLlmClient cites the first retrieved doc) and asserts the grounded
assessment is retrieved, cited, and emitted as an evidence item tiered by the
credibility registry (ADR-0038): an unknown grounded domain stays tier4, but a
registry publisher (nation.africa, who.int …) is credited at its true tier, and
the STRONGEST surfaced publisher anchors the row.
"""

from __future__ import annotations

from app.fakes.fake_corroboration import FakeCorroboration
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.hop_requests import VerifyHopRequest
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore

_CLAIM = "Drinking industrial bleach cures COVID-19 infection."


class _EmptyFactCheck:
    """Fact Check Tools API that matches nothing — the sparse-retrieval case."""

    async def search(self, claim_text: str, language_code: str) -> list[object]:
        return []


def _request(**kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": _CLAIM}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


async def test_grounded_rescue_supplies_cited_evidence_when_factcheck_empty() -> None:
    corr = FakeCorroboration()
    corr.seed_rescue(
        _CLAIM,
        "refuted",
        "The claim asserts that drinking bleach cures COVID-19. Reputable health "
        "authorities say bleach is toxic and does not cure any infection; the claim is refuted.",
        citations=["https://example.org/grounded-health-source", "https://example.org/second"],
    )
    result = await run_verify_hop(
        _request(),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=corr,
    )

    assert result.rejected is False
    assert result.verdict is not None
    # The grounded assessment was retrieved and cited by the draft...
    assert any(c.doc_id == "grounded-web-assessment" for c in result.verdict.citations)
    # ...and emitted as a (tier4, unverified) evidence item carrying the grounding URL.
    assert any(e.url == "https://example.org/grounded-health-source" for e in result.evidence)
    assert any(e.credibility_tier == "tier4_unverified" for e in result.evidence)


async def test_grounded_rescue_credits_registry_tier_and_picks_strongest_anchor() -> None:
    # ADR-0038 flywheel: the grounded assessment is no longer buried at a blanket
    # tier4. A registry publisher among the surfaced citations is credited at its
    # true tier, and the STRONGEST (highest-tier) citation anchors the evidence row
    # — even when it is not the first citation returned by grounding.
    corr = FakeCorroboration()
    corr.seed_rescue(
        _CLAIM,
        "refuted",
        "The claim asserts that drinking bleach cures COVID-19. Reputable health "
        "authorities say bleach is toxic and does not cure any infection; the claim is refuted.",
        # Order deliberately weak→strong: an unknown blog first, then tier2
        # nation.africa, then tier1 who.int. The anchor must be who.int (tier1).
        citations=[
            "https://example.org/unknown-blog",
            "https://www.nation.africa/kenya/news/story",
            "https://www.who.int/news/bleach-advisory",
        ],
    )
    result = await run_verify_hop(
        _request(),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=corr,
    )

    assert result.verdict is not None
    grounded = [e for e in result.evidence if e.url == "https://www.who.int/news/bleach-advisory"]
    assert grounded, "strongest (tier1) citation should anchor the grounded evidence row"
    # Credited at the registry tier, NOT the old blanket tier4.
    assert grounded[0].credibility_tier == "tier1_primary"
    # Provenance stays explicit to the reader.
    assert "AI-grounded web assessment (via who.int)" == grounded[0].title
    # The weaker citations are NOT emitted as (fabricated-quote) evidence rows.
    assert not any(e.url == "https://example.org/unknown-blog" for e in result.evidence)


async def test_no_rescue_when_factcheck_returns_sources() -> None:
    # When retrieval already has sources, the rescue must NOT fire (the fake has
    # no seeded rescue -> it would raise; the hop must never call it).
    from app.clients.factcheck_api import FakeFactCheckClient

    result = await run_verify_hop(
        _request(),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),  # unseeded: rescue would raise if called
    )
    assert result.verdict is not None
    for c in result.verdict.citations:
        assert c.doc_id != "grounded-web-assessment"
