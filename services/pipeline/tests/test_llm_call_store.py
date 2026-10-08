"""Per-LLM-call cost audit (ADR-0011 §7 / llm_calls): one row per model call.

Contract under test (inputs -> outputs, not internals):
  * `map_stage_to_enum` only ever yields a value the real `llm_stage` enum
    permits — the whole reason the mapping exists (see the store's module
    docstring: the pipeline's real stage names are NOT enum members, and a raw
    INSERT of them would fail and, being fail-open, drop every row).
  * a real analyze/verify UsageRecord becomes a row with the right fields.
  * the REAL verify hop records a `grounded_rescue` row when a grounded rescue
    runs (happy path, driven end-to-end through run_verify_hop).
  * a FAILING store write (DB error) is fail-open: `record` never raises and the
    verify hop still produces a verdict.

The Postgres-backed row-lands-with-the-mapped-stage proof needs DATABASE_URL_TEST
(see tests/conftest.py's `pg_conn`); it is skipped when that is unset.
"""

from __future__ import annotations

import psycopg

from app.fakes.fake_corroboration import FakeCorroboration
from app.fakes.fake_embedder import FakeEmbedder
from app.fakes.fake_llm_client import FakeLlmClient
from app.models.hop_requests import VerifyHopRequest
from app.models.pipeline_io import UsageRecord
from app.stages.idempotency import InMemoryIdempotencyStore
from app.stages.verify import run_verify_hop
from app.stores.check_store_memory import InMemoryCheckStore
from app.stores.llm_call_store import (
    _VALID_LLM_STAGE,
    InMemoryLlmCallStore,
    LlmCall,
    PostgresLlmCallStore,
    map_stage_to_enum,
)

_CLAIM = "Drinking industrial bleach cures COVID-19 infection."


class _EmptyFactCheck:
    """Fact Check Tools API that matches nothing — forces the grounded-rescue
    path (same double as the existing grounded-rescue hop tests)."""

    async def search(self, claim_text: str, language_code: str) -> list[object]:
        return []


class _BrokenConn:
    """A psycopg-connection-shaped stub whose every cursor use raises — lets the
    fail-open contract be proven WITHOUT a real database. Records whether the
    store rolled the poisoned transaction back."""

    def __init__(self) -> None:
        self.rolled_back = False

    def cursor(self) -> object:
        raise RuntimeError("simulated broken connection (no cursor)")

    def commit(self) -> None:  # pragma: no cover - never reached (cursor() raises first)
        raise AssertionError("commit should not be reached when cursor() fails")

    def rollback(self) -> None:
        self.rolled_back = True


def _verify_request(**kwargs: object) -> VerifyHopRequest:
    base = {"submission_id": "sub-1", "org_id": "org-1", "claim_text": _CLAIM}
    base.update(kwargs)
    return VerifyHopRequest(**base)  # type: ignore[arg-type]


def _seeded_corroboration(usd: float) -> FakeCorroboration:
    corr = FakeCorroboration()
    corr.seed_rescue(
        _CLAIM,
        "refuted",
        "The claim asserts bleach cures COVID-19. Reputable health authorities say "
        "bleach is toxic and cures no infection; the claim is refuted.",
        citations=["https://example.org/grounded-health-source"],
        usd=usd,
    )
    return corr


# --- the stage mapping is always enum-safe (the bug it prevents) --------------


def test_map_stage_to_enum_never_returns_a_value_the_enum_rejects() -> None:
    # Every semantic stage the pipeline actually emits, plus an unknown one, must
    # map onto a member of the real llm_stage enum — otherwise the INSERT would
    # raise and (being fail-open) silently drop the row.
    for stage in ("analyze", "verify", "corroboration", "grounded_rescue", "totally-unknown"):
        assert map_stage_to_enum(stage) in _VALID_LLM_STAGE


def test_map_stage_to_enum_passes_through_an_already_valid_stage() -> None:
    for valid in _VALID_LLM_STAGE:
        assert map_stage_to_enum(valid) == valid


def test_map_stage_to_enum_buckets_the_grounded_lanes_onto_retrieve() -> None:
    # Documented lossiness: corroboration + grounded_rescue both land on
    # "retrieve" and are told apart by model/usd, not stage.
    assert map_stage_to_enum("corroboration") == "retrieve"
    assert map_stage_to_enum("grounded_rescue") == "retrieve"
    assert map_stage_to_enum("analyze") == "extract"
    assert map_stage_to_enum("verify") == "draft"


# --- in-memory fake: a call becomes a row with the right fields ---------------


def test_from_usage_carries_every_field_including_cached_tokens() -> None:
    usage = UsageRecord(
        stage="verify",
        model="claude-sonnet",
        input_tokens=120,
        cached_tokens=40,
        output_tokens=300,
        usd=0.0075,
    )
    store = InMemoryLlmCallStore()
    store.record(LlmCall.from_usage("org-xyz", usage))

    assert len(store.calls) == 1
    row = store.calls[0]
    assert row.org_id == "org-xyz"
    assert row.stage == "verify"
    assert row.model == "claude-sonnet"
    assert row.input_tokens == 120
    assert row.cached_tokens == 40
    assert row.output_tokens == 300
    assert row.usd == 0.0075


# --- the REAL verify hop records a grounded_rescue row (happy path) ------------


async def test_verify_hop_records_a_grounded_rescue_cost_row() -> None:
    store = InMemoryLlmCallStore()
    result = await run_verify_hop(
        _verify_request(),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=_seeded_corroboration(usd=0.0123),
        llm_call_store=store,
    )

    assert result.rejected is False
    rescue_rows = [c for c in store.calls if c.stage == "grounded_rescue"]
    assert len(rescue_rows) == 1
    row = rescue_rows[0]
    assert row.org_id == "org-1"
    assert row.usd == 0.0123
    # The gemini rescue reports only a usd estimate — no token breakdown.
    assert (row.input_tokens, row.cached_tokens, row.output_tokens) == (0, 0, 0)
    # And it maps onto a storable enum bucket.
    assert map_stage_to_enum(row.stage) in _VALID_LLM_STAGE


async def test_verify_hop_without_a_store_is_a_no_op() -> None:
    # Fakes-first default: a caller that does not wire the store records nothing
    # and the hop is unaffected (existing callers/tests stay green).
    result = await run_verify_hop(
        _verify_request(),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=_seeded_corroboration(usd=0.01),
    )
    assert result.rejected is False


# --- fail-open: a failing write never crashes the hop -------------------------


def test_postgres_store_record_is_fail_open_when_the_write_raises() -> None:
    broken = _BrokenConn()
    store = PostgresLlmCallStore(broken)  # type: ignore[arg-type]

    # Must NOT raise despite the connection being broken...
    store.record(
        LlmCall(
            org_id="org-1",
            stage="verify",
            model="claude-sonnet",
            input_tokens=1,
            cached_tokens=0,
            output_tokens=1,
            usd=0.001,
        )
    )
    # ...and must have rolled the poisoned transaction back so the SHARED
    # connection is usable by the next caller.
    assert broken.rolled_back is True


async def test_verify_hop_still_succeeds_when_the_llm_calls_write_fails() -> None:
    # The task's required failure mode: the DB write fails -> the hop still
    # succeeds. A PostgresLlmCallStore over a broken connection raises internally
    # on the rescue row write; the hop must still produce a verdict.
    broken = _BrokenConn()
    result = await run_verify_hop(
        _verify_request(),
        llm=FakeLlmClient(),
        embedder=FakeEmbedder(),
        check_store=InMemoryCheckStore(),
        factcheck_client=_EmptyFactCheck(),  # type: ignore[arg-type]
        store=InMemoryIdempotencyStore(),
        corroboration_client=_seeded_corroboration(usd=0.01),
        llm_call_store=PostgresLlmCallStore(broken),  # type: ignore[arg-type]
    )
    assert result.rejected is False
    assert result.verdict is not None
    assert broken.rolled_back is True  # the failed write was rolled back, not swallowed silently


# --- Postgres-backed proof against the REAL table (needs DATABASE_URL_TEST) ----


def test_postgres_store_writes_a_real_row_with_the_mapped_stage(pg_conn: psycopg.Connection) -> None:
    """RED->GREEN against the REAL `llm_calls` table + `llm_stage` enum: a
    semantic "verify" call persists as a row whose stage is the mapped enum
    value "draft" (a raw "verify" would raise `invalid input value for enum`)."""
    store = PostgresLlmCallStore(pg_conn)
    org_id = "00000000-0000-0000-0000-000000000001"  # the org pg_conn seeds

    store.record(
        LlmCall(
            org_id=org_id,
            stage="verify",
            model="claude-sonnet-x",
            input_tokens=120,
            cached_tokens=40,
            output_tokens=300,
            usd=0.0075,
        )
    )
    # The two grounded lanes both land on "retrieve".
    store.record(
        LlmCall(
            org_id=org_id,
            stage="grounded_rescue",
            model="gemini-grounded-x",
            input_tokens=0,
            cached_tokens=0,
            output_tokens=0,
            usd=0.04,
        )
    )

    with pg_conn.cursor() as cur:
        cur.execute(
            "SELECT stage, model, input_tokens, cached_tokens, output_tokens, usd "
            "FROM llm_calls WHERE model IN ('claude-sonnet-x', 'gemini-grounded-x') ORDER BY model"
        )
        rows = cur.fetchall()

    assert len(rows) == 2
    draft_row = next(r for r in rows if r[1] == "claude-sonnet-x")
    assert draft_row[0] == "draft"  # "verify" was mapped to the enum's "draft"
    assert (draft_row[2], draft_row[3], draft_row[4]) == (120, 40, 300)
    assert float(draft_row[5]) == 0.0075

    rescue_row = next(r for r in rows if r[1] == "gemini-grounded-x")
    assert rescue_row[0] == "retrieve"  # "grounded_rescue" mapped to "retrieve"
    assert float(rescue_row[5]) == 0.04
