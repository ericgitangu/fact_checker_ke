#!/usr/bin/env bash
# ADR-0024 (trust & safety / moderation) acceptance tests. Run from
# repo root:
#   DATABASE_URL_TEST=postgres://... bash scripts/at/at-0024.sh
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

pnpm exec moon run core:build db:build >/dev/null

echo "== AT-0024-1 unit: the fake, no-billable-call objectionable-content scorer flags phone/slur/spam-link patterns =="
if pnpm --filter @fact-checker-ke/api exec vitest run src/__tests__/moderation-filter.test.ts 2>&1 \
     | tee /tmp/at-0024-unit.log | tail -40; then
  pass "AT-0024-unit (scorer)"
else
  fail "AT-0024-unit" "vitest exited non-zero; see /tmp/at-0024-unit.log"
fi

if [ -z "${DATABASE_URL_TEST:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    fail "AT-0024-ENV" "DATABASE_URL_TEST is required when CI=true (ADR-0019 #5: never skip in CI)."
    exit 1
  fi
  echo "DATABASE_URL_TEST unset and CI!=true -- the integration suites below self-skip" \
    "(local-dev convenience only; this is NOT a pass)."
fi

echo "== AT-0024-1/AT-0024-3 integration: flagged comment held pending (invisible to readers)," \
     "ongoing-protest-event check rejects new comments and re-allows once concluded =="
if DATABASE_URL_TEST="${DATABASE_URL_TEST:-}" pnpm --filter @fact-checker-ke/api exec vitest run \
     --config vitest.integration.config.ts src/__tests__/moderation.integration.test.ts 2>&1 \
     | tee /tmp/at-0024-integration.log | tail -60; then
  pass "AT-0024-1/AT-0024-3 integration"
else
  fail "AT-0024 integration" "vitest exited non-zero; see /tmp/at-0024-integration.log"
fi

echo "== AT-0024-2/AT-0024-4/AT-0024-5 integration: duplicate-device report is a no-op, three distinct" \
     "devices auto-hide; abuse-contact route; moderator rejected on publish but allowed on moderation routes" \
     "(exercised inside the ADR-0025 editorial-gate live-demo suite) =="
if DATABASE_URL_TEST="${DATABASE_URL_TEST:-}" pnpm --filter @fact-checker-ke/api exec vitest run \
     --config vitest.integration.config.ts src/__tests__/editorial-gate.integration.test.ts 2>&1 \
     | tee /tmp/at-0024-editorial-shared.log | tail -60; then
  pass "AT-0024-2/AT-0024-4/AT-0024-5 integration"
else
  fail "AT-0024-2/4/5 integration" "vitest exited non-zero; see /tmp/at-0024-editorial-shared.log"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0024 CHECKS: GREEN"
else
  echo "AT-0024 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
