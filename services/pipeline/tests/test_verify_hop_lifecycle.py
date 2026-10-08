"""ADR-0038 editorial-lifecycle OUTCOME emitted by the real /hops/verify path.

The verify hop now carries three editorial fields on its `publish` payload —
`lifecycle`, `source_kind`, `authoritative` — which the API persists onto
`checks.lifecycle_state`/`source_kind`/`authoritative` (this service never
writes Neon). These drive the real hop end-to-end (no hand-built VerifyResult)
and prove the four contract branches:

  1. auto-publish            → published  / None                    / true
  2. held + rescue assessment (even 0 citations) → preliminary / ai_grounded_preliminary / false
  3. held + empty/errored rescue → awaiting_sources / None          / false
  4. FEATURE_PRELIMINARY_THREADS=false → held emits NO lifecycle (unchanged)

The reliability fix (an assessment with 0 grounding citations still yields a
preliminary, instead of being discarded) is exercised directly by case 2.
"""

from __future__ import annotations

from app.clients.factcheck_api import FakeFactCheckClient
from app.fakes.fake_corroboration import FakeCorroboration
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.hop_requests import VerifyHopRequest
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore

# Fixture marker (fake_llm_client.py) that drives the REAL draft -> publish path
# to a non-named, Tier-A, confidence-0.97 auto-publishable verdict.
_AUTO_PUBLISH_CLAIM = (
    "AUTO_PUBLISH_FIXTURE_HIGH_CONFIDENCE Fuel prices rose sharply across Kenya this month."
)
_HELD_CLAIM = "A specific unverifiable figure about county budgets circulated on WhatsApp."


class _EmptyFactCheck:
    """Fact Check Tools API that matches nothing — the sparse-retrieval case
    that routes a non-auto-published item through the grounded rescue."""

    async def search(self, claim_text: str, language_code: str) -> list[object]:
        return []


def _request(claim: str, **kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": claim}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


async def test_auto_publish_emits_lifecycle_published() -> None:
    result = await run_verify_hop(
        _request(_AUTO_PUBLISH_CLAIM),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),  # supplies factcheck:fake:0 → citable
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),
    )
    assert result.publish is not None
    assert result.publish.auto_publish is True
    assert result.publish.lifecycle == "published"
    assert result.publish.source_kind is None
    assert result.publish.authoritative is True


async def test_held_with_rescue_assessment_zero_citations_is_preliminary() -> None:
    # The reliability fix: a grounded rescue that returns an assessment but ZERO
    # citations must NOT be discarded — it yields a non-authoritative preliminary.
    corr = FakeCorroboration()
    corr.seed_rescue(
        _HELD_CLAIM,
        "inconclusive",
        "Reputable sources do not confirm the specific county-budget figure; the "
        "claim is unverified pending authoritative data.",
        citations=[],  # 0 citations — the prod Swahili failure mode
    )
    result = await run_verify_hop(
        _request(_HELD_CLAIM),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=corr,
    )
    assert result.publish is not None
    assert result.publish.auto_publish is False
    assert result.publish.lifecycle == "preliminary"
    assert result.publish.source_kind == "ai_grounded_preliminary"
    assert result.publish.authoritative is False
    # 0 citations → no citable evidence doc was appended.
    assert result.evidence == []


async def test_held_with_empty_rescue_is_awaiting_sources() -> None:
    # Unseeded fake → rescue() raises CorroborationError → no usable assessment.
    result = await run_verify_hop(
        _request(_HELD_CLAIM),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),  # unseeded: rescue raises
    )
    assert result.publish is not None
    assert result.publish.auto_publish is False
    assert result.publish.lifecycle == "awaiting_sources"
    assert result.publish.source_kind is None
    assert result.publish.authoritative is False


async def test_flag_off_held_emits_no_lifecycle(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # FEATURE_PRELIMINARY_THREADS=false → fall back to today's held-draft
    # behaviour: a held item (even one with a usable rescue assessment) emits
    # NO editorial lifecycle, and authoritative stays at the default.
    monkeypatch.setenv("FEATURE_PRELIMINARY_THREADS", "false")
    corr = FakeCorroboration()
    corr.seed_rescue(
        _HELD_CLAIM,
        "inconclusive",
        "An assessment that WOULD be a preliminary when the flag is on.",
        citations=[],
    )
    result = await run_verify_hop(
        _request(_HELD_CLAIM),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=corr,
    )
    assert result.publish is not None
    assert result.publish.auto_publish is False
    assert result.publish.lifecycle is None
    assert result.publish.source_kind is None
    assert result.publish.authoritative is True


async def test_flag_off_auto_publish_still_emits_published(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # Auto-publish semantics are unchanged by the flag: a published outcome is
    # still emitted (the flag only gates the NEW preliminary/awaiting_sources).
    monkeypatch.setenv("FEATURE_PRELIMINARY_THREADS", "false")
    result = await run_verify_hop(
        _request(_AUTO_PUBLISH_CLAIM),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),
    )
    assert result.publish is not None
    assert result.publish.auto_publish is True
    assert result.publish.lifecycle == "published"


async def test_hard_failure_is_dismissed() -> None:
    # TRIGGER_FAILURE forces the draft call to raise → retry → rejected draft
    # (no verdict). ADR-0038: a hard failure is a terminal `dismissed` outcome.
    result = await run_verify_hop(
        _request("TRIGGER_FAILURE this claim can never be drafted"),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),
    )
    assert result.rejected is True
    assert result.verdict is None
    assert result.publish is not None
    assert result.publish.auto_publish is False
    assert result.publish.lifecycle == "dismissed"
    assert result.publish.authoritative is False
