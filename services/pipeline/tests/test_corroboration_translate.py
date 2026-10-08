"""ADR-0036 translate-then-ground (empirically validated 2026-10-08): a non-English
claim is translated to English BEFORE grounding, because Google Search grounding
returns few/zero citations (and sometimes the wrong stance) for raw Swahili/Sheng.

These are contract tests with a recording stub for the genai client — no network.
They assert WHAT text reaches the grounding model (English for a `sw` claim, the
original for an `en` claim, the original when the flag is off), which is the whole
point of the feature.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.clients.corroboration_gemini import RealGeminiCorroboration


class _Web:
    def __init__(self, uri: str) -> None:
        self.uri = uri


class _Chunk:
    def __init__(self, uri: str) -> None:
        self.web = _Web(uri)


class _GroundingMeta:
    def __init__(self, uris: list[str]) -> None:
        self.grounding_chunks = [_Chunk(u) for u in uris]


class _Candidate:
    def __init__(self, uris: list[str]) -> None:
        self.grounding_metadata = _GroundingMeta(uris)


class _Resp:
    def __init__(self, text: str, *, citations: list[str] | None = None) -> None:
        self.text = text
        # ADR-0038: a successful grounding response carries ≥1 citation. These
        # tests assert translation ROUTING via call count, so the grounding stub
        # returns a citation — otherwise the ADR-0038 retry-on-zero-citations
        # (corroboration_gemini._generate_grounded) would legitimately fire a
        # second grounding call and the call-count assertions would double.
        self.candidates: list[Any] = [_Candidate(citations)] if citations else []
        self.usage_metadata = None


class _Models:
    def __init__(self, outer: _RecordingClient) -> None:
        self._outer = outer

    def generate_content(self, *, model: str, contents: str, config: Any) -> _Resp:
        self._outer.contents_seen.append(contents)
        # Translation calls have no tools; grounding calls carry a google_search tool.
        is_translate = getattr(config, "tools", None) in (None, [])
        if is_translate:
            return _Resp("The Governor of Nairobi has been arrested by the EACC.")
        return _Resp(
            "SUPPORTED\nReputable sources confirm the arrest.",
            citations=["https://nation.africa/kenya/news"],
        )


class _RecordingClient:
    def __init__(self) -> None:
        self.contents_seen: list[str] = []
        self.models = _Models(self)


def _client() -> RealGeminiCorroboration:
    c = RealGeminiCorroboration.__new__(RealGeminiCorroboration)  # skip SDK construction
    from google.genai import types  # type: ignore[import-not-found]

    c._types = types  # type: ignore[attr-defined]
    c._client = _RecordingClient()  # type: ignore[attr-defined]
    return c


_SW_CLAIM = "Gavana wa Nairobi amekamatwa na EACC."


async def test_non_english_claim_is_translated_before_grounding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_TRANSLATE", "true")
    monkeypatch.setenv("GEMINI_CORROBORATION_GROUNDED", "true")
    c = _client()
    stance, _text, _cites, _usd = await c.rescue(claim_text=_SW_CLAIM, language="sw")
    seen = c._client.contents_seen  # type: ignore[attr-defined]
    # Two calls: a translate call (gets the raw Swahili) then a grounding call
    # (must get the ENGLISH translation, never the raw Swahili).
    assert len(seen) == 2
    assert _SW_CLAIM in seen[0]  # translate prompt carries the original
    assert "Governor of Nairobi" in seen[1]  # grounding prompt carries the English
    assert _SW_CLAIM not in seen[1]
    assert stance == "supported"


async def test_english_claim_is_not_translated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_TRANSLATE", "true")
    c = _client()
    await c.rescue(claim_text="The Nairobi governor was arrested.", language="en")
    seen = c._client.contents_seen  # type: ignore[attr-defined]
    assert len(seen) == 1  # no translation call for an English claim


async def test_flag_off_grounds_raw_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_TRANSLATE", "false")
    c = _client()
    await c.rescue(claim_text=_SW_CLAIM, language="sw")
    seen = c._client.contents_seen  # type: ignore[attr-defined]
    assert len(seen) == 1  # translation disabled -> single grounding call
    assert _SW_CLAIM in seen[0]  # ...on the raw Swahili


async def test_assess_also_translates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_TRANSLATE", "true")
    monkeypatch.setenv("GEMINI_CORROBORATION_GROUNDED", "true")
    c = _client()
    stance, _cites, _usd = await c.assess(claim_text=_SW_CLAIM, language="sw")
    seen = c._client.contents_seen  # type: ignore[attr-defined]
    assert len(seen) == 2
    assert "Governor of Nairobi" in seen[1]
    assert stance == "supported"


# --- ADR-0038 retry-on-zero-citations reliability fix ----------------------
class _FlakyGroundingModels:
    """Grounding returns 0 citations on the first call, then citations on the
    second — the observed Vertex non-determinism ADR-0038's retry guards."""

    def __init__(self, outer: _RecordingClient) -> None:
        self._outer = outer
        self._grounding_calls = 0

    def generate_content(self, *, model: str, contents: str, config: Any) -> _Resp:
        self._outer.contents_seen.append(contents)
        is_translate = getattr(config, "tools", None) in (None, [])
        if is_translate:  # pragma: no cover - English claim here, no translate
            return _Resp("translated")
        self._grounding_calls += 1
        if self._grounding_calls == 1:
            return _Resp("INCONCLUSIVE\nNo sources surfaced this call.", citations=None)
        return _Resp(
            "SUPPORTED\nSecond grounded call surfaced sources.",
            citations=["https://nation.africa/kenya/news"],
        )


def _flaky_client() -> RealGeminiCorroboration:
    c = RealGeminiCorroboration.__new__(RealGeminiCorroboration)
    from google.genai import types  # type: ignore[import-not-found]

    c._types = types  # type: ignore[attr-defined]
    rc = _RecordingClient()
    rc.models = _FlakyGroundingModels(rc)  # type: ignore[assignment]
    c._client = rc  # type: ignore[attr-defined]
    return c


async def test_rescue_retries_once_when_grounding_returns_zero_citations() -> None:
    c = _flaky_client()
    stance, _text, cites, _usd = await c.rescue(
        claim_text="The Nairobi governor was arrested.", language="en"
    )
    # Exactly one retry: 2 grounding calls total, and the citations from the
    # SECOND (non-empty) call win rather than the first call's empty set.
    assert len(c._client.contents_seen) == 2  # type: ignore[attr-defined]
    assert cites == ["https://nation.africa/kenya/news"]
    assert stance == "supported"


async def test_rescue_does_not_retry_beyond_once() -> None:
    # A persistently-empty grounding is tried at most twice, then returns the
    # (citation-less) assessment rather than looping — cost-bounded.
    c = _client()

    class _AlwaysEmpty(_Models):
        def generate_content(self, *, model: str, contents: str, config: Any) -> _Resp:
            self._outer.contents_seen.append(contents)
            if getattr(config, "tools", None) in (None, []):  # pragma: no cover
                return _Resp("translated")
            return _Resp("INCONCLUSIVE\nnothing", citations=None)

    c._client.models = _AlwaysEmpty(c._client)  # type: ignore[attr-defined]
    _stance, _text, cites, _usd = await c.rescue(
        claim_text="The Nairobi governor was arrested.", language="en"
    )
    assert len(c._client.contents_seen) == 2  # type: ignore[attr-defined] # one retry, no more
    assert cites == []


# --- ADR-0037 citation redirect resolution ---------------------------------
import httpx

from app.clients.corroboration_gemini import _resolve_citations

_VERTEX = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC"


def _patch_httpx(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    orig = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda *a, **k: orig(*a, transport=httpx.MockTransport(handler), **k)
    )


async def test_resolves_vertex_redirect_to_real_domain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_RESOLVE_CITATIONS", "true")

    def handler(req: httpx.Request) -> httpx.Response:
        if "vertexaisearch" in str(req.url):
            return httpx.Response(302, headers={"location": "https://nation.africa/kenya/news"})
        return httpx.Response(200)

    _patch_httpx(monkeypatch, handler)
    out = await _resolve_citations([_VERTEX, "https://already.real/x"])
    assert out[0] == "https://nation.africa/kenya/news"  # redirect followed
    assert out[1] == "https://already.real/x"  # non-vertex URL left untouched


async def test_resolve_flag_off_returns_raw(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_RESOLVE_CITATIONS", "false")
    out = await _resolve_citations([_VERTEX])
    assert out == [_VERTEX]


async def test_resolve_failure_keeps_raw_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORROBORATION_RESOLVE_CITATIONS", "true")

    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    _patch_httpx(monkeypatch, handler)
    out = await _resolve_citations([_VERTEX])
    assert out == [_VERTEX]  # fail-safe: never drop a source
