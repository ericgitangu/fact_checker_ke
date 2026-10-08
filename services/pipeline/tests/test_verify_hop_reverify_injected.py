"""ADR-0038 Wave 2 re-verify entry: crowdsourced `injected_docs` folded into
the REAL /hops/verify path.

Proves the three contract branches end-to-end through `run_verify_hop` (no
hand-built VerifyResult):

  (i)   injected_docs present → the draft is built AGAINST them (they become
        citable evidence) and the no-source grounded rescue is NEVER invoked.
  (ii)  injected_docs absent (None) → unchanged behaviour: retrieval is empty,
        the grounded rescue IS consulted (today's awaiting_sources path).
  (iii) a named-person claim with injected_docs that would otherwise clear into
        the auto_publish=True band NEVER emits lifecycle='published' — it routes
        to editor_review (the hard legal invariant: no [A] edge publishes a
        named person). The non-named twin DOES publish, proving the guard is
        named-specific, not a blanket block.
"""

from __future__ import annotations

from app.fakes.fake_corroboration import FakeCorroboration
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.hop_requests import InjectedDoc, VerifyHopRequest
from app.protocols.corroboration import Stance
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore

_REVERIFY_CLEARS = "REVERIFY_CLEARS_FIXTURE_HIGH_CONFIDENCE The claimed event is corroborated."
_OPEN_CLAIM = "A specific unverifiable figure about county budgets circulated on WhatsApp."

_INJECTED_URL = "https://www.nation.africa/kenya/news/example-report"
_INJECTED_TEXT = (
    "The National Treasury's published budget statement confirms the county "
    "allocation figure cited in the claim."
)


class _EmptyFactCheck:
    """Fact Check Tools API that matches nothing (sparse-retrieval case)."""

    async def search(self, claim_text: str, language_code: str) -> list[object]:
        return []


class _RescueSpyCorroboration(FakeCorroboration):
    """FakeCorroboration that records whether the grounded rescue was invoked,
    so a test can prove the no-source rescue path was (not) taken."""

    def __init__(self) -> None:
        super().__init__()
        self.rescue_calls = 0

    async def rescue(self, *, claim_text: str, language: str) -> tuple[Stance, str, list[str], float]:
        self.rescue_calls += 1
        return await super().rescue(claim_text=claim_text, language=language)


def _request(claim: str, **kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-reverify", "org_id": "org-1", "claim_text": claim}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


def _one_injected() -> list[InjectedDoc]:
    return [InjectedDoc(url=_INJECTED_URL, title="nation.africa", text=_INJECTED_TEXT)]


async def test_injected_docs_drafted_against_and_rescue_not_invoked() -> None:
    # (i) injected_docs present → retrieval is non-empty → the draft cites the
    # injected doc (it becomes persistable evidence) and the grounded rescue is
    # NEVER consulted (the `if not retrieved` guard short-circuits). The spy
    # proves the rescue call count stays at zero even though the Fact Check
    # Tools API returned nothing.
    spy = _RescueSpyCorroboration()
    result = await run_verify_hop(
        _request(_OPEN_CLAIM, injected_docs=_one_injected()),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=spy,
    )
    assert spy.rescue_calls == 0, "injected_docs present must skip the no-source rescue"
    assert result.rejected is not True
    assert result.verdict is not None
    # The draft was built against the injected evidence → it surfaces as a
    # persisted evidence item carrying the injected URL.
    assert result.evidence, "expected the injected doc to be drafted against and cited"
    assert any(ev.url == _INJECTED_URL for ev in result.evidence)
    # And it was NOT turned into an AI-grounded preliminary (that is the rescue
    # path, which we proved was not taken).
    assert result.publish is not None
    assert result.publish.source_kind != "ai_grounded_preliminary"


async def test_injected_docs_absent_is_unchanged_rescue_path() -> None:
    # (ii) injected_docs absent (None, the default) → retrieval is empty → the
    # grounded rescue IS consulted (today's behaviour). Unseeded spy raises
    # CorroborationError → no usable assessment → awaiting_sources, exactly as
    # before this change.
    spy = _RescueSpyCorroboration()
    result = await run_verify_hop(
        _request(_OPEN_CLAIM),  # no injected_docs
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=spy,
    )
    assert spy.rescue_calls == 1, "absent injected_docs must still consult the rescue"
    assert result.publish is not None
    assert result.publish.lifecycle == "awaiting_sources"
    assert result.evidence == []


async def test_named_person_reverify_never_publishes() -> None:
    # (iii) a NAMED-person claim whose re-verify clears into the auto_publish
    # band (confidence 0.99 → Tier-C mode (a) returns auto_publish=True) MUST
    # NOT emit lifecycle='published'. It routes to editor_review instead.
    result = await run_verify_hop(
        _request(_REVERIFY_CLEARS, named_person_involved=True, injected_docs=_one_injected()),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),
    )
    assert result.publish is not None
    # The processing decision still cleared (auto_publish True) ...
    assert result.publish.auto_publish is True
    # ... but the editorial track refuses to publish a named person.
    assert result.publish.lifecycle != "published"
    assert result.publish.lifecycle == "editor_review"
    assert result.publish.authoritative is False


async def test_non_named_reverify_publishes() -> None:
    # The named-specific twin of (iii): the SAME clearing re-verify on a
    # NON-named claim DOES auto-publish, proving the guard blocks only named
    # persons, not every cleared re-verify.
    result = await run_verify_hop(
        _request(_REVERIFY_CLEARS, named_person_involved=False, injected_docs=_one_injected()),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=FakeCorroboration(),
    )
    assert result.publish is not None
    assert result.publish.auto_publish is True
    assert result.publish.lifecycle == "published"
    assert result.publish.authoritative is True
