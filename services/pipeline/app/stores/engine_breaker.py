"""ADR-0032 §4 / AT-0032-5 (ADR-0011 per-engine cost breaker): the fetch
engine's OWN daily-spend breaker, independent of the submission engine's.

AT-0032-5 (verbatim): "The fetch engine has its own daily-spend breaker:
at 80% it stops emitting new candidates while dedup/trend updates
continue; at 100% it hard-stops polling; the submission engine's budget
and operation are unaffected by a fetch overspend (and vice-versa)."

The isolation guarantee is structural, not just "we tested it once": the
Postgres-backed implementation keys its row on `(engine, day)`
(db/migrations/0013's `engine_spend_daily`, `UNIQUE(engine, day)`), so a
write for `engine="fetch"` can only ever read/update the `"fetch"` row —
there is no code path by which it could touch the `"submission"` row, and
vice versa. `InMemoryEngineCostBreaker` mirrors this with two
independent dict keys for the same reason (fast unit-test double; no
Postgres required).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal, Protocol

import psycopg

# "corroboration" (ADR-0036) is a THIRD, independent daily-spend lane for the
# grounded second-opinion gate — isolated from fetch/submission so a second-
# opinion spike can never starve either real engine (and vice-versa). Its budget
# defaults deliberately tiny (near-0 MVP cost cap) so the per-day CALL count is
# bounded even on the free tier where each call's USD is ~0.
Engine = Literal["fetch", "submission", "corroboration"]

# ADR-0032 §4's two breaker thresholds, as fractions of the configured
# daily budget. Not tier-specific, not tunable per call — a single
# module-level constant pair, same "named, not magic" discipline as
# app/stages/publish_policy.py's TAU_* constants.
SOFT_STOP_FRACTION = 0.80
HARD_STOP_FRACTION = 1.00

# Placeholder starting budgets (same tech-debt class as TAU_A/TAU_B in
# publish_policy.py — NOT fit from a real spend model, just a
# conservative default so the breaker is exercisable out of the box).
# Overridable per engine via env (`FETCH_ENGINE_DAILY_BUDGET_USD` /
# `SUBMISSION_ENGINE_DAILY_BUDGET_USD`).
# corroboration: ~$0.30/day. Combined with ESTIMATED_CALL_USD=0.003 in
# app/stages/corroboration.py, that is a hard ~100-calls/day cap — a near-0 MVP
# allocation (owner cost rule: stay at/near free-tier until monetization).
# Override via CORROBORATION_ENGINE_DAILY_BUDGET_USD.
DEFAULT_DAILY_BUDGET_USD: dict[Engine, float] = {"fetch": 5.00, "submission": 20.00, "corroboration": 0.30}


def _budget_env_var(engine: Engine) -> str:
    return f"{engine.upper()}_ENGINE_DAILY_BUDGET_USD"


def configured_daily_budget_usd(engine: Engine) -> float:
    raw = os.environ.get(_budget_env_var(engine))
    if raw is None:
        return DEFAULT_DAILY_BUDGET_USD[engine]
    return float(raw)


@dataclass(frozen=True, slots=True)
class BreakerState:
    engine: Engine
    usd_spent: float
    daily_budget_usd: float
    # True once spend >= 80% of budget: emitting NEW candidates must
    # stop; dedup/trend-counter updates (app/stages/fetch_hop.py's
    # `record_observation`/`upsert_candidate` calls) continue regardless
    # of this flag — only the emission step checks it.
    soft_stopped: bool
    # True once spend >= 100% of budget: polling itself must hard-stop
    # (app/stages/fetch_hop.py must not call `source.poll(...)` again)
    # until the next UTC day's row.
    hard_stopped: bool


class EngineCostBreaker(Protocol):
    def record_spend(self, engine: Engine, usd_cost: float) -> BreakerState:
        """Adds `usd_cost` to today's running total for `engine` and
        returns the resulting state. Called BEFORE a spend-incurring
        action (an LLM call, in this slice's intended caller) so the
        returned state reflects the budget as it will stand immediately
        after — a caller that sees `hard_stopped=True` must not proceed
        with the action it was about to meter."""
        ...

    def current_state(self, engine: Engine) -> BreakerState:
        """Reads today's state for `engine` without recording any new
        spend — used by app/stages/fetch_hop.py's hard-stop check at the
        top of a run, before any source has been polled at all."""
        ...


def _state_from_totals(engine: Engine, usd_spent: float, daily_budget_usd: float) -> BreakerState:
    return BreakerState(
        engine=engine,
        usd_spent=usd_spent,
        daily_budget_usd=daily_budget_usd,
        soft_stopped=usd_spent >= daily_budget_usd * SOFT_STOP_FRACTION,
        hard_stopped=usd_spent >= daily_budget_usd * HARD_STOP_FRACTION,
    )


class InMemoryEngineCostBreaker:
    """Process-lifetime-only reference implementation (same tech-debt
    class as every other InMemory* store in this service) — two
    independent `(engine, day)` keys in one dict, proving the isolation
    guarantee without needing Postgres for a fast unit test."""

    def __init__(self) -> None:
        self._totals: dict[tuple[Engine, date], float] = {}

    def _today(self) -> date:
        return datetime.now(UTC).date()

    def record_spend(self, engine: Engine, usd_cost: float) -> BreakerState:
        key = (engine, self._today())
        self._totals[key] = self._totals.get(key, 0.0) + usd_cost
        return self.current_state(engine)

    def current_state(self, engine: Engine) -> BreakerState:
        key = (engine, self._today())
        spent = self._totals.get(key, 0.0)
        return _state_from_totals(engine, spent, configured_daily_budget_usd(engine))


class PostgresEngineCostBreaker:
    """Postgres-backed implementation (migration 0013's
    `engine_spend_daily`, `UNIQUE(engine, day)`). `daily_budget_usd` is
    snapshotted into the row at its first write of the UTC day — see
    the table's docstring in packages/db/src/schema.ts for why a later
    env-var change must not retroactively rewrite an already-open day's
    threshold."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def _today(self) -> date:
        return datetime.now(UTC).date()

    def record_spend(self, engine: Engine, usd_cost: float) -> BreakerState:
        today = self._today()
        budget = configured_daily_budget_usd(engine)
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO engine_spend_daily (engine, day, usd_spent, daily_budget_usd)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (engine, day) DO UPDATE SET
                        usd_spent = engine_spend_daily.usd_spent + EXCLUDED.usd_spent,
                        updated_at = now()
                    RETURNING usd_spent, daily_budget_usd
                    """,
                    (engine, today, usd_cost, budget),
                )
                row = cur.fetchone()
            self._conn.commit()
        except Exception:
            # Roll the aborted transaction back so the SHARED connection is not
            # left poisoned (InFailedSqlTransaction) for the next caller, then
            # re-raise for the caller's own fail-closed handling.
            self._conn.rollback()
            raise
        assert row is not None
        usd_spent, daily_budget_usd = row
        return _state_from_totals(engine, float(usd_spent), float(daily_budget_usd))

    def current_state(self, engine: Engine) -> BreakerState:
        today = self._today()
        budget = configured_daily_budget_usd(engine)
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT usd_spent, daily_budget_usd FROM engine_spend_daily WHERE engine = %s AND day = %s",
                (engine, today),
            )
            row = cur.fetchone()
        if row is None:
            return _state_from_totals(engine, 0.0, budget)
        usd_spent, daily_budget_usd = row
        return _state_from_totals(engine, float(usd_spent), float(daily_budget_usd))


__all__ = [
    "DEFAULT_DAILY_BUDGET_USD",
    "HARD_STOP_FRACTION",
    "SOFT_STOP_FRACTION",
    "BreakerState",
    "Engine",
    "EngineCostBreaker",
    "InMemoryEngineCostBreaker",
    "PostgresEngineCostBreaker",
    "configured_daily_budget_usd",
]
