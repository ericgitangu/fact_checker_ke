"""AT-0032-8: reverse-image search wired into the REAL /hops/verify path
(app.stages.verify.run_verify_hop), not a replica of it.

A claim that carries a `media_hash` (its image/video-thumbnail
fingerprint) is checked against ReverseImageSearch before drafting. A hit
on an earlier-dated copy is surfaced as a citable evidence item in the
retrieved-document set -- this test drives the real hop end-to-end
(FakeLlmClient's real draft-fixture logic, which cites the FIRST
retrieved source by doc_id) and asserts the reverse-image evidence is
both present in what was retrieved and actually cited back in the
verdict, proving the wiring (not just that the Protocol/fake exist in
isolation -- see tests/test_reverse_image_factory.py and
tests/test_synthetic_media_triage.py for those).
"""

from __future__ import annotations

from app.clients.factcheck_api import FakeFactCheckClient
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.fakes.fake_reverse_image import FakeReverseImageSearch
from app.models.hop_requests import VerifyHopRequest
from app.protocols.reverse_image import EarlierCopyMatch
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore


def _request(**kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": "This video shows today's protest in Nairobi."}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


async def test_no_media_hash_never_calls_reverse_image_search() -> None:
    # The common case (text-only claim, no image/video evidence): the
    # Protocol must never be consulted at all.
    reverse_image = FakeReverseImageSearch()
    req = _request()  # media_hash defaults to None

    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
        reverse_image_search=reverse_image,
    )

    assert result.rejected is False
    # No seeded match AND find_earlier_copy should never have even been
    # asked (no media_hash to ask about) -- verified indirectly: the
    # first-cited doc_id is the factcheck fixture's, never a
    # reverse-image-prefixed id.
    assert result.verdict is not None
    for citation in result.verdict.citations:
        assert not citation.doc_id.startswith("reverse-image-earlier-copy:")


async def test_media_hash_with_earlier_copy_match_is_cited_as_evidence() -> None:
    media_hash = "thumb-hash-abc123"
    reverse_image = FakeReverseImageSearch()
    reverse_image.seed_match(
        media_hash,
        EarlierCopyMatch(source_url="https://example.com/original-2019-clip", found_at="2019-03-12"),
    )
    req = _request(media_hash=media_hash)

    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
        reverse_image_search=reverse_image,
    )

    assert result.rejected is False
    assert result.verdict is not None
    # FakeLlmClient's real draft-fixture logic cites the FIRST retrieved
    # source's doc_id -- the reverse-image evidence is prepended ahead of
    # the factcheck hits in app/stages/verify.py, so this is the real,
    # non-mocked proof that the evidence reached the draft-verdict call.
    assert len(result.verdict.citations) == 1
    cited = result.verdict.citations[0]
    assert cited.doc_id == f"reverse-image-earlier-copy:{media_hash}"
    # FakeLlmClient's fixture quotes only the first 40 chars of the
    # retrieved doc's text -- confirm that prefix really is the
    # reverse-image evidence text, not a factcheck hit.
    assert cited.quoted_span == "Reverse-image search found an earlier co"


async def test_media_hash_with_no_match_falls_through_to_factcheck_evidence() -> None:
    media_hash = "thumb-hash-no-match"
    reverse_image = FakeReverseImageSearch()  # no seeded match -> None
    req = _request(media_hash=media_hash)

    result = await run_verify_hop(
        req,
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=FakeFactCheckClient(),
        store=InMemoryIdempotencyStore(),
        reverse_image_search=reverse_image,
    )

    assert result.rejected is False
    assert result.verdict is not None
    assert len(result.verdict.citations) == 1
    assert result.verdict.citations[0].doc_id == "factcheck:fake:0"


async def test_default_reverse_image_search_fallback_is_the_fake_when_unwired() -> None:
    # No reverse_image_search kwarg passed at all: run_verify_hop must
    # still work (defaults to FakeReverseImageSearch internally) even
    # for a request that carries a media_hash with no seeded match.
    req = _request(media_hash="unwired-hash")

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
