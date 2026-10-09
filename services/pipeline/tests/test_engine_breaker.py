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


def test_reserve_or_refund_refunds_a_denied_reservation(monkeypatch) -> None:
    """Regression (verified 2026-10-09: the corroboration lane's reported spend
    drifted to ~$1.04 against its $0.30 cap). A DENIED reservation must NOT leave
    its estimate on the day's total — reserve_or_refund refunds it, so repeated
    rejected attempts can't inflate usd_spent past the budget."""
    from app.stores.engine_breaker import reserve_or_refund

    monkeypatch.setenv("CORROBORATION_ENGINE_DAILY_BUDGET_USD", "0.30")
    breaker = InMemoryEngineCostBreaker()

    # Reserve until the cap denies the next one (the reservation that would reach
    # >= 0.30 is denied + refunded, so the total settles just under budget).
    allowed = 0
    while reserve_or_refund(breaker, "corroboration", 0.003):
        allowed += 1
        assert allowed <= 1000  # safety against a runaway loop if the cap never trips
    at_cap = breaker.current_state("corroboration").usd_spent
    assert at_cap <= 0.30  # NEVER exceeded the budget
    assert at_cap > 0.29  # ...but got right up to it

    # 500 further attempts are all DENIED and REFUNDED — the total must not move.
    for _ in range(500):
        assert reserve_or_refund(breaker, "corroboration", 0.003) is False
    after = breaker.current_state("corroboration").usd_spent
    assert after == at_cap  # unchanged (pre-fix: each denied attempt added 0.003 -> ~1.80)


def test_reserve_or_refund_allows_until_cap(monkeypatch) -> None:
    monkeypatch.setenv("SUBMISSION_ENGINE_DAILY_BUDGET_USD", "0.10")
    from app.stores.engine_breaker import reserve_or_refund

    breaker = InMemoryEngineCostBreaker()
    allowed = sum(1 for _ in range(10) if reserve_or_refund(breaker, "submission", 0.03))
    # 0.03 reservations: 0.03, 0.06, 0.09 allowed (<0.10); 0.12 would cross -> denied+refunded.
    assert allowed == 3
    assert round(breaker.current_state("submission").usd_spent, 4) == 0.09
