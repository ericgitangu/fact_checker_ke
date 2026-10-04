"""AT-0032-5: the fetch engine's own daily-spend breaker, independent of
the submission engine's. Fast unit tests run against
InMemoryEngineCostBreaker; the Postgres-backed isolation proof
(test_postgres_breaker_isolates_fetch_and_submission_rows) needs
DATABASE_URL_TEST."""

from __future__ import annotations

from app.stores.engine_breaker import (
    HARD_STOP_FRACTION,
    SOFT_STOP_FRACTION,
    InMemoryEngineCostBreaker,
    PostgresEngineCostBreaker,
    configured_daily_budget_usd,
)


def test_soft_stop_trips_at_80_percent_not_before(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "10.00")
    breaker = InMemoryEngineCostBreaker()

    state = breaker.record_spend("fetch", 7.99)
    assert state.soft_stopped is False
    assert state.hard_stopped is False

    state = breaker.record_spend("fetch", 0.01)  # now exactly 8.00 == 80% of 10
    assert state.soft_stopped is True
    assert state.hard_stopped is False


def test_hard_stop_trips_at_100_percent(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "10.00")
    breaker = InMemoryEngineCostBreaker()
    state = breaker.record_spend("fetch", 10.00)
    assert state.soft_stopped is True
    assert state.hard_stopped is True


def test_submission_engine_spend_never_affects_fetch_engine_state(monkeypatch) -> None:
    """AT-0032-5's isolation guarantee, direction 1: a submission-engine
    overspend does not starve/trip the fetch engine's breaker."""
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "10.00")
    monkeypatch.setenv("SUBMISSION_ENGINE_DAILY_BUDGET_USD", "10.00")
    breaker = InMemoryEngineCostBreaker()

    # Blow well past 100% of the SUBMISSION engine's budget.
    breaker.record_spend("submission", 50.00)
    submission_state = breaker.current_state("submission")
    assert submission_state.hard_stopped is True

    # The FETCH engine's state must be completely untouched.
    fetch_state = breaker.current_state("fetch")
    assert fetch_state.usd_spent == 0.0
    assert fetch_state.soft_stopped is False
    assert fetch_state.hard_stopped is False


def test_fetch_engine_spend_never_affects_submission_engine_state(monkeypatch) -> None:
    """AT-0032-5's isolation guarantee, direction 2: the reverse."""
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "5.00")
    monkeypatch.setenv("SUBMISSION_ENGINE_DAILY_BUDGET_USD", "20.00")
    breaker = InMemoryEngineCostBreaker()

    breaker.record_spend("fetch", 5.00)  # 100% of fetch's budget
    fetch_state = breaker.current_state("fetch")
    assert fetch_state.hard_stopped is True

    submission_state = breaker.current_state("submission")
    assert submission_state.usd_spent == 0.0
    assert submission_state.hard_stopped is False
    assert submission_state.soft_stopped is False


def test_configured_daily_budget_usd_defaults_without_env() -> None:
    # No env var set for either engine -- falls back to the documented
    # default, never a KeyError/None.
    assert configured_daily_budget_usd("fetch") > 0
    assert configured_daily_budget_usd("submission") > 0


def test_postgres_breaker_isolates_fetch_and_submission_rows(pg_conn, monkeypatch) -> None:
    """Same isolation guarantee, proven against the REAL Postgres table
    (engine_spend_daily, UNIQUE(engine, day)) rather than the in-memory
    double."""
    monkeypatch.setenv("FETCH_ENGINE_DAILY_BUDGET_USD", "5.00")
    monkeypatch.setenv("SUBMISSION_ENGINE_DAILY_BUDGET_USD", "20.00")
    breaker = PostgresEngineCostBreaker(pg_conn)

    fetch_state = breaker.record_spend("fetch", 5.00)
    assert fetch_state.hard_stopped is True

    # A FRESH breaker instance against the same connection (same
    # "survives a recycle" proof as the dedup store's test).
    fresh_breaker = PostgresEngineCostBreaker(pg_conn)
    submission_state = fresh_breaker.current_state("submission")
    assert submission_state.usd_spent == 0.0
    assert submission_state.hard_stopped is False

    with pg_conn.cursor() as cur:
        cur.execute("SELECT engine, usd_spent FROM engine_spend_daily ORDER BY engine")
        rows = cur.fetchall()
    assert rows == [("fetch", 5.00)]


def test_thresholds_are_the_adr_0032_5_values() -> None:
    assert SOFT_STOP_FRACTION == 0.80
    assert HARD_STOP_FRACTION == 1.00
