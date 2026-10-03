"""Deterministic dedup guard (ADR-0004 amendment #8, ADR-0023 §3).

Reuse of an existing check requires: cosine similarity >= tau AND
negation/number/entity/date agreement. This module implements the
agreement check deterministically — no LLM call — so the guard itself
can't be prompt-injected and is cheap to run on every dedup candidate.

Scope and known limits (explicit, not buried): this is a lightweight,
regex/keyword-based NLP pass, not a trained NER model. It is deliberately
conservative — see module-level NEGATION_CUES — mirroring the "uncertain
-> treat as code-switched" bias the owner's prior `wave` project used for
language-ID (ADR-0005 ASR amendments). A real entity extractor is future
work; until then this guard may over-reject (force a fresh verification
pass when reuse would have been fine), which is the safe failure
direction for a defamation-risk system, never the reverse.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# en + sw negation cues (ADR-0004 amendment #8's "did *not* raise fuel tax"
# example). Not exhaustive; see module docstring.
NEGATION_CUES: frozenset[str] = frozenset(
    {
        # English
        "not",
        "never",
        "didn't",
        "did not",
        "doesn't",
        "does not",
        "won't",
        "will not",
        "isn't",
        "is not",
        "no longer",
        "cannot",
        "can't",
        # Swahili
        "hakuna",
        "hajafanya",
        "hajawahi",
        "si",
        "sio",
        "hawajafanya",
        "hajaongeza",
        "hakuongeza",
        "haitaongezeka",
    }
)

_NUMBER_RE = re.compile(r"\b\d[\d,.]*%?")
_DATE_RE = re.compile(
    r"\b(?:\d{4}|\d{1,2}/\d{1,2}/\d{2,4}|"
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b",
    re.IGNORECASE,
)
# Crude proper-noun / entity proxy: capitalized words not at sentence start
# are too fragile with punctuation-split text, so instead we take all
# capitalized tokens of length >= 2 as entity candidates — intentionally
# over-inclusive (false positives here only make the guard stricter, never
# laxer, which is the safe direction).
_ENTITY_RE = re.compile(r"\b[A-Z][a-zA-Z]{1,}\b")


_BARE_YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")


def extract_numbers(text: str) -> frozenset[str]:
    """Numeric values (money, percentages, counts), deliberately excluding
    a bare 4-digit token that looks like a year (e.g. "2026") — those are
    dates, captured by extract_dates instead, so a claim differing only by
    year (ADR-0004 amendment #8's "stale-statistic reuse" case) is caught
    by the *date* mismatch check rather than colliding into "numeric value
    mismatch" for an unrelated reason."""
    candidates = (m.group(0).rstrip(".") for m in _NUMBER_RE.finditer(text))
    return frozenset(c for c in candidates if not _BARE_YEAR_RE.fullmatch(c))


def extract_dates(text: str) -> frozenset[str]:
    return frozenset(m.group(0).lower() for m in _DATE_RE.finditer(text))


def extract_entities(text: str) -> frozenset[str]:
    return frozenset(m.group(0) for m in _ENTITY_RE.finditer(text))


def has_negation(text: str) -> bool:
    lowered = text.lower()
    return any(cue in lowered for cue in NEGATION_CUES)


@dataclass(frozen=True)
class DedupSignals:
    numbers: frozenset[str]
    dates: frozenset[str]
    entities: frozenset[str]
    negation_present: bool

    @classmethod
    def from_text(cls, text: str) -> DedupSignals:
        return cls(
            numbers=extract_numbers(text),
            dates=extract_dates(text),
            entities=extract_entities(text),
            negation_present=has_negation(text),
        )


def signals_agree(a: DedupSignals, b: DedupSignals) -> tuple[bool, str | None]:
    """Returns (agree, reason_if_not). Mismatched negation polarity is the
    hard blocker from ADR-0004 amendment #8 / ADR-0023 §3 / AT-0023-4."""
    if a.negation_present != b.negation_present:
        return False, "negation polarity mismatch"
    if a.numbers != b.numbers:
        return False, "numeric value mismatch"
    if a.dates != b.dates:
        return False, "date mismatch"
    if a.entities != b.entities:
        return False, "named entity mismatch"
    return True, None


def may_reuse(
    *, cosine_similarity: float, tau: float, new_text: str, existing_text: str
) -> tuple[bool, str | None]:
    """Top-level gate: cosine_similarity >= tau AND full signal agreement.
    Returns (may_reuse, reason_if_blocked)."""
    if cosine_similarity < tau:
        return False, "below similarity threshold"
    agree, reason = signals_agree(
        DedupSignals.from_text(new_text), DedupSignals.from_text(existing_text)
    )
    if not agree:
        return False, reason
    return True, None
