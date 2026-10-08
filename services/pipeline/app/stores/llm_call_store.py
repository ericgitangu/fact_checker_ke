"""Per-LLM-call cost audit (ADR-0011 §7): one `llm_calls` row per model call —
`{org_id, stage, model, input_tokens, cached_tokens, output_tokens, usd}`.

Closes a real gap: the `llm_calls` table (packages/db/src/schema.ts) exists but
NOTHING writes to it, so per-call spend is not auditable (daily spend IS tracked
separately by the per-engine breaker in app/stores/engine_breaker.py). This store
is the write path, deliberately mirroring that breaker's shape: a `Protocol`, a
`Postgres*` implementation backed by the SAME psycopg connection app/main.py opens
once at process start, and an in-memory fake-first double so callers/tests that do
not wire it are a pure no-op (identical convention to InMemoryEngineCostBreaker /
FakeCorroboration / FakeReverseImageSearch).

FAIL-OPEN CONTRACT: `record()` MUST NOT raise. A cost-audit row is bookkeeping; a
failed write is logged and dropped, never allowed to fail the hop that made the
call. This is the same posture app/stages/verify.py already applies to the
breaker's metering ("cost metering must NEVER crash the verify hop").

STAGE-ENUM IMPEDANCE MISMATCH (verified empirically 2026-10-08 against the real
schema — docker Postgres with all db/migrations applied, and db/migrations/
0001_baseline.sql, never ALTERed): the `llm_calls.stage` column is the Postgres
enum `llm_stage`, whose ONLY permitted values are:

    normalize | transcribe | extract | retrieve | draft

The pipeline's actual per-call stage names are "analyze" and "verify" (the
`complete_with_usage(stage=...)` call sites in app/stages/analyze.py and
app/stages/verify.py), plus the two grounded-Gemini lanes this change records,
"corroboration" and "grounded_rescue". NONE of those four is in the enum, so a raw
INSERT of them raises `invalid input value for enum llm_stage` — and because the
write is fail-open, that would silently drop EVERY row, leaving `llm_calls` empty:
the exact bug this wiring is meant to fix. Until the enum is extended, each semantic
stage is mapped onto the closest existing enum bucket (see `map_stage_to_enum`).

TECH DEBT (surfaced, not buried): the mapping is LOSSY — "corroboration" and
"grounded_rescue" both land on "retrieve" and are distinguishable only by `model`
(anthropic vs gemini) + `usd`, not by `stage`. The real fix is a follow-up
migration:

    ALTER TYPE llm_stage ADD VALUE 'analyze';
    ALTER TYPE llm_stage ADD VALUE 'verify';
    ALTER TYPE llm_stage ADD VALUE 'corroboration';
    ALTER TYPE llm_stage ADD VALUE 'grounded_rescue';

after which `map_stage_to_enum` becomes a pass-through and the raw stage is written.
A DB-schema change is explicitly out of scope for this change (the table already
exists; this change only writes rows to it).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

import psycopg

from app.models.pipeline_io import UsageRecord

_log = logging.getLogger(__name__)

# The llm_stage enum members, mirrored here so `map_stage_to_enum` can tell an
# already-valid stage from one that needs mapping. Kept in lockstep with
# db/migrations/0001_baseline.sql's `CREATE TYPE "llm_stage"`.
_VALID_LLM_STAGE: frozenset[str] = frozenset(
    {"normalize", "transcribe", "extract", "retrieve", "draft"}
)

# Semantic pipeline stage -> nearest llm_stage enum bucket. See the module
# docstring for why this exists and the follow-up migration that retires it.
_STAGE_TO_ENUM: dict[str, str] = {
    "analyze": "extract",  # analyze hop = claim extraction/classification
    "verify": "draft",  # verify hop = draft-verdict generation
    "corroboration": "retrieve",  # grounded second-opinion (assess) = web retrieval
    "grounded_rescue": "retrieve",  # grounded no-source rescue = web retrieval
}

# A last-resort valid bucket for a stage we neither recognise nor can map, so the
# INSERT still satisfies the NOT-NULL enum column rather than failing (and being
# fail-open dropped). Hitting this logs a warning — it is never silent.
_FALLBACK_ENUM_STAGE = "draft"


def map_stage_to_enum(stage: str) -> str:
    """Map a semantic pipeline stage name onto a value the `llm_stage` enum
    actually permits (see module docstring). Returns the stage unchanged when it
    is already a valid enum member; otherwise the mapped bucket; otherwise a
    logged fallback so the write never fails on an enum violation."""
    if stage in _VALID_LLM_STAGE:
        return stage
    mapped = _STAGE_TO_ENUM.get(stage)
    if mapped is not None:
        return mapped
    _log.warning(
        "llm_calls: pipeline stage %r has no llm_stage enum mapping; recording it as %r "
        "(extend the llm_stage enum to record it faithfully)",
        stage,
        _FALLBACK_ENUM_STAGE,
    )
    return _FALLBACK_ENUM_STAGE


@dataclass(frozen=True, slots=True)
class LlmCall:
    """One per-call cost row to persist. `stage` is the SEMANTIC pipeline stage
    (e.g. "verify", "grounded_rescue"); the mapping to the storable `llm_stage`
    enum happens at write time in `map_stage_to_enum`, so the semantic name is
    preserved for logging and so the mapping lives in exactly one place."""

    org_id: str
    stage: str
    model: str
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    usd: float

    @classmethod
    def from_usage(cls, org_id: str, usage: UsageRecord) -> LlmCall:
        """Build a row from the `UsageRecord` the analyze/verify LLM calls already
        return (`complete_with_usage`). `cached_tokens` is threaded straight from
        the UsageRecord (0 when the client does not report prompt-cache hits)."""
        return cls(
            org_id=org_id,
            stage=usage.stage,
            model=usage.model,
            input_tokens=usage.input_tokens,
            cached_tokens=usage.cached_tokens,
            output_tokens=usage.output_tokens,
            usd=usage.usd,
        )


class LlmCallStore(Protocol):
    def record(self, call: LlmCall) -> None:
        """Persist ONE per-LLM-call cost row.

        MUST be fail-open: a telemetry write that fails is logged and swallowed,
        NEVER raised, so a hop is never failed by its own cost bookkeeping.
        """
        ...


class InMemoryLlmCallStore:
    """Process-lifetime-only reference/fake implementation (same tech-debt class
    as every other InMemory* store in this service). Fake-first default: a caller
    that does not wire a real store gets this no-network double, so existing
    callers/tests are a pure no-op. `calls` is exposed for test assertions."""

    def __init__(self) -> None:
        self.calls: list[LlmCall] = []

    def record(self, call: LlmCall) -> None:
        # Cannot fail — trivially honours the fail-open contract.
        self.calls.append(call)


class PostgresLlmCallStore:
    """Postgres-backed implementation (migration 0001's `llm_calls`). Uses the
    SAME shared, process-lifetime psycopg connection as PostgresEngineCostBreaker
    / PostgresFetchDedupStore (opened once in app/main.py)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def record(self, call: LlmCall) -> None:
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO llm_calls
                        (org_id, stage, model, input_tokens, cached_tokens, output_tokens, usd)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        call.org_id,
                        map_stage_to_enum(call.stage),
                        call.model,
                        call.input_tokens,
                        call.cached_tokens,
                        call.output_tokens,
                        call.usd,
                    ),
                )
            self._conn.commit()
        except Exception:  # noqa: BLE001 - telemetry write is fail-open (see Protocol)
            # Roll the aborted transaction back so the SHARED connection is not
            # left poisoned (InFailedSqlTransaction) for the next caller — same
            # discipline as PostgresEngineCostBreaker.record_spend. UNLIKE the
            # breaker, do NOT re-raise: a per-call cost row must never fail the
            # hop that produced it. The failure IS logged here (this module has a
            # logger; app/stages/verify.py does not), so nothing is swallowed
            # silently.
            try:
                self._conn.rollback()
            except Exception:  # noqa: BLE001, S110 - best-effort rollback of an already-broken conn
                pass
            _log.warning(
                "llm_calls: failed to persist a %r cost row (fail-open; row dropped)",
                call.stage,
                exc_info=True,
            )


__all__ = [
    "InMemoryLlmCallStore",
    "LlmCall",
    "LlmCallStore",
    "PostgresLlmCallStore",
    "map_stage_to_enum",
]
