from __future__ import annotations

from app.fakes.fake_llm_client import FakeLlmClient
from app.models.hop_requests import AnalyzeHopRequest, HopContent
from app.stages.analyze import run_analyze_hop
from app.stages.idempotency import InMemoryIdempotencyStore


def _request(**content_kwargs: object) -> AnalyzeHopRequest:
    return AnalyzeHopRequest(
        submission_id="sub-1",
        org_id="org-1",
        content=HopContent(**content_kwargs),
    )


async def test_checkable_claim_classified_and_translated() -> None:
    req = _request(text="KNBS reports inflation at 7% in 2026.")
    result = await run_analyze_hop(req, llm=FakeLlmClient(), store=InMemoryIdempotencyStore())
    assert result.language == "en"
    assert len(result.claims) == 1
    assert result.claims[0].claim_type.value == "checkable"
    assert result.attribution is None
    assert result.usage.stage == "analyze"
    assert result.usage.usd >= 0


async def test_question_classified_as_opinion() -> None:
    req = _request(text="Isn't the government doing a great job?")
    result = await run_analyze_hop(req, llm=FakeLlmClient(), store=InMemoryIdempotencyStore())
    assert result.claims[0].claim_type.value == "opinion"


async def test_video_url_submission_carries_unverified_attribution() -> None:
    req = _request(url="https://tiktok.com/@someone/video/123", quote="The minister said prices will fall.")
    result = await run_analyze_hop(req, llm=FakeLlmClient(), store=InMemoryIdempotencyStore())
    assert result.attribution == "unverified"
    # The quote is passed through untouched, never a fabricated transcript.
    assert "minister" in result.translation_en.lower() or "minister" in str(result.claims[0].text).lower()


async def test_analyze_hop_is_idempotent_on_content_hash() -> None:
    req = _request(text="KNBS reports inflation at 7% in 2026.")
    store = InMemoryIdempotencyStore()
    llm = FakeLlmClient()
    first = await run_analyze_hop(req, llm=llm, store=store)
    second = await run_analyze_hop(req, llm=llm, store=store)
    assert first == second


async def test_swahili_text_detected_as_sw() -> None:
    req = _request(text="Serikali imeongeza bei ya mafuta leo.")
    result = await run_analyze_hop(req, llm=FakeLlmClient(), store=InMemoryIdempotencyStore())
    assert result.language == "sw"


async def test_dropped_items_sampled_for_editor_review_at_0004_e() -> None:
    # A single dropped (non-checkable) item: >=10% sampling means it must
    # itself be the sampled one (ceil(1 * 0.10) == 1).
    req = _request(text="Isn't the government doing a great job?")
    result = await run_analyze_hop(req, llm=FakeLlmClient(), store=InMemoryIdempotencyStore())
    assert result.claims[0].sampled_for_editor_review is True
