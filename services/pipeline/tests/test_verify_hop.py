from __future__ import annotations

from datetime import date

from app.clients.factcheck_api import FakeFactCheckClient
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.enums import Rating
from app.models.hop_requests import VerifyHopRequest
from app.protocols.check_store import StoredCheck
from app.stages.dedup_guard import DedupSignals
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore


def _request(**kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": "KNBS reports inflation at 7% in 2026."}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


async def test_draft_verdict_happy_path_citation_clean() -> None:
    req = _request()
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
    assert result.verdict.rating is not None
    assert result.usage is not None


async def test_dedup_reuse_when_similar_claim_already_stored() -> None:
    claim_text = "KNBS reports inflation at 7% in 2026."
    embedder = FakeEmbedder()
    check_store = InMemoryCheckStore()
    signals = DedupSignals.from_text(claim_text)
    check_store.save(
        StoredCheck(
            check_id="existing-1",
            claim_text=claim_text,
            embedding=embedder.embed(claim_text),
            rating=Rating.true,
            valid_as_of=date(2026, 1, 1),
            numbers=signals.numbers,
            dates=signals.dates,
            entities=signals.entities,
            negation_present=signals.negation_present,
        )
    )
    result = await run_verify_hop(
        _request(claim_text=claim_text),
        llm=FakeLlmClient(),
        embedder=embedder,
        check_store=check_store,
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )
    assert result.reused_existing_check is True
    assert result.verdict is not None
    assert result.verdict.rating == Rating.true
    assert result.valid_as_of == "2026-01-01"


async def test_dedup_does_not_reuse_on_negation_mismatch_at_0023_4() -> None:
    embedder = FakeEmbedder()
    check_store = InMemoryCheckStore()
    existing_text = "The government raised fuel tax in 2026."
    signals = DedupSignals.from_text(existing_text)
    check_store.save(
        StoredCheck(
            check_id="existing-1",
            claim_text=existing_text,
            embedding=embedder.embed(existing_text),
            rating=Rating.true,
            valid_as_of=date(2026, 1, 1),
            numbers=signals.numbers,
            dates=signals.dates,
            entities=signals.entities,
            negation_present=signals.negation_present,
        )
    )
    new_text = "The government did not raise fuel tax in 2026."
    result = await run_verify_hop(
        _request(claim_text=new_text),
        llm=FakeLlmClient(),
        embedder=embedder,
        check_store=check_store,
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
    )
    assert result.reused_existing_check is False


async def test_verify_hop_is_idempotent_on_content_hash() -> None:
    req = _request()
    store = InMemoryIdempotencyStore()
    kwargs = {
        "llm": FakeLlmClient(),
        "embedder": FakeEmbedder(),
        "check_store": InMemoryCheckStore(),
        "factcheck_client": FakeFactCheckClient(),
        "store": store,
    }
    first = await run_verify_hop(req, **kwargs)  # type: ignore[arg-type]
    second = await run_verify_hop(req, **kwargs)  # type: ignore[arg-type]
    assert first == second
