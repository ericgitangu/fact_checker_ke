"""ADR-0038 relevance/recency guard in the draft-verdict prompt.

Prod failure this closes (KTN churches claim): off-topic same-GENRE sources (a
different church theft, months old) were treated as corroboration and produced
a confident MostlyTrue. The fix is prompt-level — a deterministic fake LLM can't
exercise the model's reasoning, so these tests assert the PROMPT actually carries
the guard instructions and annotates each source with its tier + date, which is
the contract the real model reasons over. The behavioural proof is the post-deploy
re-run of the KTN scenario (a real model), not a unit test.
"""

from __future__ import annotations

from app.prompts.templates import build_draft_verdict_prompt


def _prompt(**kw: object) -> str:
    base = {
        "claim_text": "A businessman is under investigation for a church equipment theft syndicate.",
        "retrieved_sources": [("src-1", "A different trader was accused of a separate church break-in in June.")],
        "credibility_context": "registry context",
        "named_person_involved": False,
    }
    base.update(kw)
    return build_draft_verdict_prompt(**base)  # type: ignore[arg-type]


def test_prompt_forbids_genre_level_corroboration() -> None:
    p = _prompt()
    # The core anti-genre instruction must be present.
    assert "same specific event" in p.lower()
    assert "category-level plausibility" in p.lower()
    assert "general phenomenon is real" in p.lower()
    # And it must say a different incident is NOT support.
    assert "different incident" in p.lower()


def test_prompt_carries_recency_guard_and_tier4_is_a_lead() -> None:
    p = _prompt()
    assert "recency" in p.lower()
    assert "lead, not confirmation" in p.lower()


def test_sources_annotated_with_tier_and_date_from_meta() -> None:
    p = _prompt(
        retrieved_sources=[("src-1", "text one"), ("src-2", "text two")],
        source_meta={
            "src-1": ("tier2_established_media", "2026-06-26"),
            # src-2 deliberately absent → must degrade to unknown/unknown.
        },
    )
    assert 'id="src-1" tier="tier2_established_media" date="2026-06-26"' in p
    assert 'id="src-2" tier="unknown" date="unknown"' in p


def test_missing_meta_defaults_to_unknown() -> None:
    # No source_meta at all → every source is unknown tier + date (honest: we
    # cannot confirm currency of a source whose date we never captured).
    p = _prompt(retrieved_sources=[("only", "body")])
    assert 'id="only" tier="unknown" date="unknown"' in p
