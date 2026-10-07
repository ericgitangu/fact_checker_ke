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


class _Resp:
    def __init__(self, text: str) -> None:
        self.text = text
        self.candidates: list[Any] = []
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
        return _Resp("SUPPORTED\nReputable sources confirm the arrest.")


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
