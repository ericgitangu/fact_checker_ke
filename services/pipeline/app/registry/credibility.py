"""Credibility registry loader (ADR-0004 step 5 / §5, ADR-0023).

"Keep a hand-curated table: source -> tier, notes, last_reviewed. It is
injected into the verdict prompt as context, never used as a hard filter."
This module loads the seed JSON (app/data/credibility_registry.json, ~10
Kenyan sources) and renders it as prompt context text — it is never used to
filter retrieved documents (ADR-0004 §5's "[V]: filtering by credibility at
retrieval can remove crucial counter-evidence").
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict

from app.models.enums import CredibilityTier

_REGISTRY_PATH = Path(__file__).resolve().parent.parent / "data" / "credibility_registry.json"


class CredibilityEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    tier: CredibilityTier
    notes: str


@lru_cache(maxsize=1)
def load_registry() -> list[CredibilityEntry]:
    with _REGISTRY_PATH.open(encoding="utf-8") as f:
        payload = json.load(f)
    return [CredibilityEntry.model_validate(entry) for entry in payload["sources"]]


def tier_for_url(url: str, *, default: CredibilityTier = CredibilityTier.tier3_general) -> CredibilityTier:
    """Best-effort credibility tier for a cited source URL, by matching its
    host against the hand-curated registry (ADR-0004 §5). This is used ONLY
    to label an already-cited source for display/weighting when persisting
    evidence (ADR-0031 AT-0031-1) — never to filter retrieval (ADR-0004 §5's
    "filtering by credibility at retrieval can remove crucial
    counter-evidence"). An unknown host degrades to `default` rather than
    dropping the source."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return default
    host = host.removeprefix("www.")
    if not host:
        return default
    for entry in load_registry():
        src = entry.source.lower()
        if host == src or host.endswith("." + src) or src in host:
            return entry.tier
    return default


def render_registry_as_prompt_context() -> str:
    """Rendered as inert reference text for the draft-verdict prompt —
    context, never a retrieval filter and never instructions (ADR-0023
    containment applies to this block too: it is Claude-authored, not
    attacker-controlled, so it sits in the system/static prefix, not inside
    an <untrusted_...> tag)."""
    lines = ["Kenyan source credibility registry (context only, not a filter):"]
    for entry in load_registry():
        lines.append(f"- {entry.source} [{entry.tier.value}]: {entry.notes}")
    return "\n".join(lines)
