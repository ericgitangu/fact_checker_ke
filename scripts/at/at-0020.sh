#!/usr/bin/env bash
# ADR-0020 acceptance tests: self-hosted identity/auth/RBAC, mandatory
# TOTP MFA, immutable audit log. Run from repo root:
#   DATABASE_URL_TEST=postgres://... bash scripts/at/at-0020.sh
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

# Stale packages/{core,db}/dist poisons vitest (see at-0018.sh's note) --
# build workspace deps first.
pnpm exec moon run core:build db:build >/dev/null

echo "== AT-0020 unit: password hashing (scrypt) + TOTP/HOTP (RFC 6238/4226 vectors) =="
if pnpm --filter @fact-checker-ke/api exec vitest run src/__tests__/auth-password.test.ts src/__tests__/auth-totp.test.ts 2>&1 \
     | tee /tmp/at-0020-unit.log | tail -40; then
  pass "AT-0020-unit (password round-trip, RFC 4226 HOTP test vectors, drift window)"
else
  fail "AT-0020-unit" "vitest exited non-zero; see /tmp/at-0020-unit.log"
fi

echo "== AT-0020 schema: role/attribution/audit_log/sessions/totp_secrets pgEnums sourced from core, table shapes =="
if pnpm --filter @fact-checker-ke/db run test 2>&1 | tee /tmp/at-0020-db.log | tail -40; then
  pass "AT-0020-db"
else
  fail "AT-0020-db" "vitest exited non-zero; see /tmp/at-0020-db.log"
fi

if [ -z "${DATABASE_URL_TEST:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    fail "AT-0020-ENV" "DATABASE_URL_TEST is required when CI=true (ADR-0019 #5: never skip in CI)."
    exit 1
  fi
  echo "DATABASE_URL_TEST unset and CI!=true -- the integration suite below self-skips" \
    "(local-dev convenience only; this is NOT a pass)."
fi

echo "== AT-0020-3/AT-0020-4 integration: role grant rejected without verified MFA + audit_log rows," \
     "rolled-back action produces zero rows (real Neon Postgres, real scrypt+TOTP, real transactions) =="
if DATABASE_URL_TEST="${DATABASE_URL_TEST:-}" pnpm --filter @fact-checker-ke/api exec vitest run \
     --config vitest.integration.config.ts src/__tests__/auth-service.integration.test.ts 2>&1 \
     | tee /tmp/at-0020-integration.log | tail -60; then
  pass "AT-0020-3/AT-0020-4 integration"
else
  fail "AT-0020-3/AT-0020-4 integration" "vitest exited non-zero; see /tmp/at-0020-integration.log"
fi

echo
echo "Note: AT-0020-1/AT-0020-2/AT-0020-5 (device-token quota keying, cross-submission" \
     "capability-token rejection, device-token rotation) are the pre-existing" \
     "anonymous-token slice, already GREEN -- see scripts/at/at-0018.sh, unchanged by this wave."

if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0020 CHECKS: GREEN"
else
  echo "AT-0020 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
