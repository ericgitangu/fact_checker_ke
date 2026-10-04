"""Trending/virality check-worthiness scorer (ADR-0032 §1).

`score()` is a pure function of a `FetchScoringInput` — no LLM call, no
embedding call. This is deliberate: AT-0032-2 requires a low-scoring
candidate to be dropped *before* any embedding/LLM call is spent on it,
which is only true if scoring itself never makes one. The ADR's
"claim density" signal names a Haiku-class claim/opinion pre-filter as
the eventual implementation; this slice uses a cheap, deterministic
heuristic instead (see `estimate_claim_density`) so the "before any
LLM call" invariant holds for every candidate, not just the ones that
survive. Swapping in a real cheap-LLM pass is flagged as deferred work,
not silently implied by the ADR text.

`τ_fetch` and the weights are CONFIG (env-driven `FetchScoringConfig`,
below) — tuning them is an env/config change, never a code change
(AT-0032-2's second half).
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field

# ADR-0032 Appendix A seed terms (2026-10-04 KE-landscape research) — a
# seed for the salience allow-list, not an endorsement of any claim.
# Data, overridable via FETCH_SALIENCE_TERMS (comma-separated), never a
# code change to retune.
_DEFAULT_SALIENCE_TERMS = (
    "ruto",
    "maandamano",
    "finance bill",
    "iebc",
    "gen-z",
    "genz",
    "occupy",
    "rejectfinancebill",
    "protest",
    "police",
)

_NUMBER_RE = re.compile(r"\b\d[\d,.]*%?\b")
_ASSERTION_CUE_RE = re.compile(
    r"\b(said|announced|confirmed|reported|according to|will|has|have|claims?|"
    r"stated|revealed|banned|raised|cut|signed|ordered)\b",
    re.IGNORECASE,
)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_terms(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return tuple(t.strip().lower() for t in raw.split(",") if t.strip())


@dataclass(frozen=True, slots=True)
class FetchScoringConfig:
    """Every field is env-overridable (see `from_env`) so retuning
    `τ_fetch`/weights/half-life/salience terms is a config change, not a
    code change (AT-0032-2)."""

    tau_fetch: float = 0.5
    weight_velocity: float = 0.3
    weight_spread: float = 0.25
    weight_claim_density: float = 0.2
    weight_recency: float = 0.15
    weight_salience: float = 0.1
    # Hours until check-worthiness from recency alone halves.
    recency_half_life_hours: float = 24.0
    salience_terms: tuple[str, ...] = field(default_factory=lambda: _DEFAULT_SALIENCE_TERMS)

    @classmethod
    def from_env(cls) -> FetchScoringConfig:
        return cls(
            tau_fetch=_env_float("FETCH_TAU", 0.5),
            weight_velocity=_env_float("FETCH_WEIGHT_VELOCITY", 0.3),
            weight_spread=_env_float("FETCH_WEIGHT_SPREAD", 0.25),
            weight_claim_density=_env_float("FETCH_WEIGHT_CLAIM_DENSITY", 0.2),
            weight_recency=_env_float("FETCH_WEIGHT_RECENCY", 0.15),
            weight_salience=_env_float("FETCH_WEIGHT_SALIENCE", 0.1),
            recency_half_life_hours=_env_float("FETCH_RECENCY_HALF_LIFE_HOURS", 24.0),
            salience_terms=_env_terms("FETCH_SALIENCE_TERMS", _DEFAULT_SALIENCE_TERMS),
        )


@dataclass(frozen=True, slots=True)
class FetchScoringInput:
    """Signals the scorer needs, already derived from one or more
    FetchCandidate observations of the same item/claim (velocity needs
    at least two observations; a brand-new item scores velocity 0, not
    an error — see `run_fetch_hop`'s first-observation handling)."""

    text: str
    engagement_delta: float  # e.g. views gained since the previous observation
    hours_since_previous_observation: float
    platforms_seen: frozenset[str]
    age_hours: float


def estimate_claim_density(text: str) -> float:
    """Cheap, deterministic 0..1 estimate of "this text likely contains
    a checkable factual claim" — see module docstring for why this is
    NOT an LLM call. Heuristic: presence of a number and/or an assertion
    verb raises density; a bare question (no assertion cue) scores 0.
    Intentionally crude (not a trained classifier) — mirrors the
    conservative-by-design bias used elsewhere in this codebase (e.g.
    app/stages/dedup_guard.py's entity/negation heuristics)."""
    stripped = text.strip()
    if not stripped:
        return 0.0
    has_number = bool(_NUMBER_RE.search(stripped))
    has_assertion_cue = bool(_ASSERTION_CUE_RE.search(stripped))
    is_bare_question = stripped.endswith("?") and not has_assertion_cue
    if is_bare_question:
        return 0.1
    if has_number and has_assertion_cue:
        return 1.0
    if has_number or has_assertion_cue:
        return 0.6
    return 0.2


def _normalize_velocity(engagement_delta: float, hours: float) -> float:
    if hours <= 0:
        hours = 0.5  # avoid div-by-zero on a same-hour re-poll; still a high rate
    rate = engagement_delta / hours
    # Soft-saturate at 2000 engagement units/hour -> 1.0, so one freak
    # outlier can't blow the weighted sum past a sane range. Tuned by eye
    # (no calibration data yet), not a hard product requirement.
    return min(1.0, rate / 2000.0)


def _spread_score(platforms_seen: frozenset[str]) -> float:
    # ADR-0032 §1: the same claim/clip observed on >=2 platforms scores
    # higher; capped at 1.0 (3+ platforms doesn't score higher still).
    return min(1.0, len(platforms_seen) / 2.0)


def _recency_score(age_hours: float, half_life_hours: float) -> float:
    if half_life_hours <= 0:
        return 0.0
    return math.exp(-math.log(2) * max(0.0, age_hours) / half_life_hours)


def _salience_score(text: str, terms: tuple[str, ...]) -> float:
    lowered = text.lower()
    return 1.0 if any(term in lowered for term in terms) else 0.0


def score_candidate(signals: FetchScoringInput, *, config: FetchScoringConfig) -> float:
    """Weighted composite check-worthiness score, normalized to 0..1 by
    the sum of configured weights (so re-weighting doesn't silently
    rescale the meaning of τ_fetch)."""
    velocity = _normalize_velocity(signals.engagement_delta, signals.hours_since_previous_observation)
    spread = _spread_score(signals.platforms_seen)
    claim_density = estimate_claim_density(signals.text)
    recency = _recency_score(signals.age_hours, config.recency_half_life_hours)
    salience = _salience_score(signals.text, config.salience_terms)

    weight_sum = (
        config.weight_velocity
        + config.weight_spread
        + config.weight_claim_density
        + config.weight_recency
        + config.weight_salience
    )
    if weight_sum <= 0:
        return 0.0

    weighted = (
        config.weight_velocity * velocity
        + config.weight_spread * spread
        + config.weight_claim_density * claim_density
        + config.weight_recency * recency
        + config.weight_salience * salience
    )
    return weighted / weight_sum


__all__ = [
    "FetchScoringConfig",
    "FetchScoringInput",
    "estimate_claim_density",
    "score_candidate",
]
