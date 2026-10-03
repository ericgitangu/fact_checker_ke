"""Guards against the one kind of drift codegen can't catch by itself.

`pnpm gen:contracts` regenerates app/models/generated.py straight from
packages/core/generated/contracts.schema.json, so the *shape* of the
generated enums can never silently drift from the schema — regenerating
always overwrites it to match. What regeneration can't catch is someone
forgetting to run it: a developer edits a zod enum in packages/core, the
TypeScript side is happy, but app/models/generated.py (checked into git)
is now stale. This test reads the contract JSON Schema directly and
compares it against the *already-generated* Python enums, independent of
whether `pnpm gen:contracts` was just re-run — exactly the comparison the
CI drift gate (`git diff --exit-code` after regenerating) is meant to
backstop, but runnable without Node/pnpm in the loop.
"""

from __future__ import annotations

import json
from enum import StrEnum
from pathlib import Path
from typing import Any, cast

import pytest

from app.models import generated as gen

CONTRACTS_SCHEMA_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "core"
    / "generated"
    / "contracts.schema.json"
)

# Every StrEnum in app/models/generated.py, keyed by its $defs name in
# contracts.schema.json. `Status` (WaitlistSignupResult.status) is excluded:
# it's an *inline* zod enum (`z.enum([...])` with no exported name), so it
# has no $defs entry of its own to compare against — see waitlist.ts.
GENERATED_ENUMS: dict[str, type[StrEnum]] = {
    "ClaimType": gen.ClaimType,
    "CredibilityTier": gen.CredibilityTier,
    "DemonstrationStatus": gen.DemonstrationStatus,
    "Rating": gen.Rating,
    "SubmissionStatus": gen.SubmissionStatus,
    "WaitlistSource": gen.WaitlistSource,
}


@pytest.fixture(scope="module")
def contracts_schema() -> dict[str, Any]:
    # `Any` here is the raw JSON Schema document — inherently untyped at
    # the JSON level. We assert the shape we actually use ($defs.<Name>.enum)
    # explicitly below rather than modeling the whole JSON Schema spec.
    if not CONTRACTS_SCHEMA_PATH.exists():
        pytest.fail(
            f"{CONTRACTS_SCHEMA_PATH} is missing — run `pnpm gen:contracts` "
            "at the repo root before running pipeline tests."
        )
    with CONTRACTS_SCHEMA_PATH.open(encoding="utf-8") as f:
        # cast, not a type: ignore — json.load legitimately returns Any; we
        # assert the shape we need (`$defs.<Name>.enum`) below instead.
        return cast(dict[str, Any], json.load(f))


@pytest.mark.parametrize("def_name", sorted(GENERATED_ENUMS))
def test_generated_enum_matches_contracts_schema(
    def_name: str, contracts_schema: dict[str, Any]
) -> None:
    defs = contracts_schema["$defs"]
    assert def_name in defs, f"contracts.schema.json has no $defs/{def_name}"

    schema_values = set(defs[def_name]["enum"])
    python_values = {member.value for member in GENERATED_ENUMS[def_name]}

    assert python_values == schema_values, (
        f"{def_name}: app/models/generated.py has {python_values} but "
        f"contracts.schema.json has {schema_values} — run `pnpm gen:contracts` "
        "at the repo root to resync."
    )
