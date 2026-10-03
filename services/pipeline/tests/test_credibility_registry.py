from __future__ import annotations

from app.registry.credibility import load_registry, render_registry_as_prompt_context


def test_registry_has_at_least_ten_kenyan_sources() -> None:
    entries = load_registry()
    assert len(entries) >= 10


def test_registry_includes_tier1_official_sources() -> None:
    entries = load_registry()
    sources = {e.source for e in entries}
    assert "knbs.or.ke" in sources
    assert "kenyalaw.org" in sources


def test_registry_renders_as_context_not_a_filter_instruction() -> None:
    rendered = render_registry_as_prompt_context()
    assert "knbs.or.ke" in rendered
    # ADR-0004 §5: context only, never a hard filter.
    assert "never used as a hard filter" not in rendered  # prose lives in the ADR, not duplicated in-prompt
    assert "context only" in rendered or "not a filter" in rendered
