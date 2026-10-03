#!/usr/bin/env bash
# ADR-0025 (editorial operations) + ADR-0004 (named-person rating/
# attribution gate, AT-0004-A/AT-0004-B) acceptance tests. Run from
# repo root:
#   DATABASE_URL_TEST=postgres://... bash scripts/at/at-0025.sh
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

pnpm exec moon run core:build db:build >/dev/null

echo "== AT-0004/AT-0025 unit: checks route + repositories still green with namedPerson/attribution fields =="
if pnpm --filter @fact-checker-ke/api run test 2>&1 | tee /tmp/at-0025-unit.log | tail -40; then
  pass "AT-0025-unit"
else
  fail "AT-0025-unit" "vitest exited non-zero; see /tmp/at-0025-unit.log"
fi

if [ -z "${DATABASE_URL_TEST:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    fail "AT-0025-ENV" "DATABASE_URL_TEST is required when CI=true (ADR-0019 #5: never skip in CI)."
    exit 1
  fi
  echo "DATABASE_URL_TEST unset and CI!=true -- the integration suite below self-skips" \
    "(local-dev convenience only; this is NOT a pass)."
fi

echo "== AT-0004-A/AT-0004-B + AT-0025-1/2/3/4 + AT-0024-5 integration: full named-person" \
     "draft -> gated submitter view -> confirm attribution -> right-of-reply gate ->" \
     "public-safety override -> publish -> gated-then-ungated submitter view," \
     "against real Neon Postgres, over real HTTP (fastify.inject), real transactions =="
if DATABASE_URL_TEST="${DATABASE_URL_TEST:-}" pnpm --filter @fact-checker-ke/api exec vitest run \
     --config vitest.integration.config.ts src/__tests__/editorial-gate.integration.test.ts 2>&1 \
     | tee /tmp/at-0025-integration.log | tail -80; then
  pass "AT-0004-A/AT-0004-B/AT-0025-1/2/3/4/AT-0024-5 integration"
else
  fail "AT-0025 integration" "vitest exited non-zero; see /tmp/at-0025-integration.log"
fi

echo
echo "AT-0025-5 (backlog-overflow extended-ETA state) is an explicit STUB in this wave:" \
     "no queue-depth monitor/threshold config exists yet -- see docs/adr/0025's" \
     "implementation notes for the explicit gap. Not faked, not silently skipped."

if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0025 CHECKS: GREEN (except the explicitly-stubbed AT-0025-5, noted above)"
else
  echo "AT-0025 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
