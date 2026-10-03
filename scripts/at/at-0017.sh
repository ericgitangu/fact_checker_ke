#!/usr/bin/env bash
# ADR-0017 acceptance tests (transactional outbox + three-layer
# idempotency). Run from repo root:
#   DATABASE_URL_TEST=postgres://... bash scripts/at/at-0017.sh
#
# Each AT prints PASS/FAIL. Non-zero exit if any AT fails (ADR-0019:
# RED before implementation, GREEN after, recorded with real command
# output — not inferred from reading the code).
#
# Needs a real Postgres reachable at DATABASE_URL_TEST (local docker
# compose `pgvector/pgvector:pg17`, or a Neon `dev` branch) with
# migrations applied (`pnpm --filter @fact-checker-ke/db run db:migrate`
# against DATABASE_URL_DIRECT, or `psql -f db/migrations/000*.sql` in
# order for a from-scratch local DB).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

# These suites invoke vitest directly (bypassing moon's task graph), so a
# stale packages/{core,db}/dist silently poisons them — observed 2026-10-03
# as a bogus invalid_signature. Build workspace deps first.
pnpm exec moon run core:build db:build >/dev/null
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

if [ -z "${DATABASE_URL_TEST:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    fail "AT-0017-ENV" "DATABASE_URL_TEST is required when CI=true (ADR-0019 #5: never skip in CI)."
    exit 1
  fi
  echo "DATABASE_URL_TEST unset and CI!=true -- the integration suite below will" \
    "self-skip its describe blocks (local-dev convenience only; this is NOT a pass)."
fi

# --- AT-0017 schema + transactional-outbox + idempotency + state-machine + inbox,
# all exercised against a REAL Postgres (packages/db + services/api).
echo "== AT-0017 (schema, outbox, idempotency, state machine, inbox): vitest integration =="
if DATABASE_URL_TEST="${DATABASE_URL_TEST:-}" pnpm --filter @fact-checker-ke/api run test:integration \
     2>&1 | tee /tmp/at-0017-integration.log | tail -60; then
  pass "AT-0017-integration (submission+idempotency+outbox in one tx; replay; 422 conflict; conditional state update; inbox dedup; drain; TTL cleanup)"
else
  fail "AT-0017-integration" "vitest exited non-zero; see /tmp/at-0017-integration.log"
fi

# --- AT-0017 idempotency CONTRACT + signature-gated internal routes: fast unit suite.
echo "== AT-0017 (idempotency contract, internal-route auth, publisher dedup): vitest unit =="
if pnpm --filter @fact-checker-ke/api run test 2>&1 | tee /tmp/at-0017-unit.log | tail -40; then
  pass "AT-0017-unit"
else
  fail "AT-0017-unit" "vitest exited non-zero; see /tmp/at-0017-unit.log"
fi

# --- Contracts drift gate: event schemas (packages/core) regenerate cleanly.
echo "== AT-0017 contracts drift: event schemas regenerate with no diff =="
if pnpm gen:contracts >/tmp/at-0017-contracts.log 2>&1 && \
   git diff --exit-code -- packages/core/generated services/pipeline/app/models/generated.py >/dev/null 2>&1; then
  pass "AT-0017-contracts (no drift)"
else
  fail "AT-0017-contracts" "regenerated contracts differ from what's committed; see /tmp/at-0017-contracts.log and 'git diff packages/core/generated'"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0017 CHECKS: GREEN"
else
  echo "AT-0017 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
