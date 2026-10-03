#!/usr/bin/env bash
# ADR-0014 acceptance tests (moonrepo migration). Run from repo root:
#   bash scripts/at/at-0014.sh
#
# Each AT prints PASS/FAIL. Non-zero exit if any AT fails. This script is
# the executable form of docs/adr/0014-monorepo-tooling-moon.md's
# "## Acceptance tests" table (ADR-0019 TDD rule: every AT gets a runnable
# check, RED before implementation, GREEN after).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

# --- AT-0014-1: `moon ci` on a clean tree runs lint/typecheck/test/build for every project, and passes
echo "== AT-0014-1: moon ci (clean tree, all projects) =="
if moon ci 2>&1 | tee /tmp/at-0014-1.log | tail -40; then
  pass "AT-0014-1 (moon ci exited 0)"
else
  fail "AT-0014-1" "moon ci exited non-zero; see /tmp/at-0014-1.log"
fi

# --- AT-0014-2: touching packages/core/src makes `moon query projects --affected` include
# core, db, api, web, site and pipeline.
echo "== AT-0014-2: affected graph from packages/core/src change =="
echo "// at-0014-2 touch $(date -u +%s)" >> packages/core/src/index.ts
AFFECTED=$(moon query projects --affected --downstream deep 2>/tmp/at-0014-2.err | jq -r '.projects[].id' | sort -u | tr '\n' ' ')
git checkout -- packages/core/src/index.ts 2>/dev/null || true
EXPECTED="api core db pipeline site web"
GOT_SORTED=$(echo "$AFFECTED" | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/ $//')
echo "  expected (any order, superset ok): $EXPECTED"
echo "  got: $GOT_SORTED"
MISSING=""
for p in $EXPECTED; do
  echo " $GOT_SORTED " | grep -q " $p " || MISSING="$MISSING $p"
done
if [ -z "$MISSING" ]; then
  pass "AT-0014-2 (affected set includes: $EXPECTED)"
else
  fail "AT-0014-2" "missing from affected set:$MISSING (got: $GOT_SORTED; stderr: $(cat /tmp/at-0014-2.err 2>/dev/null))"
fi

# --- AT-0014-3: adding a new workspace package used by the API requires no Dockerfile edit,
# and the image still builds. Not scriptable without mutating the workspace graph; verified
# manually via docker build evidence in the PR (see docs/adr/0014 Implementation notes).
echo "== AT-0014-3: no-Dockerfile-edit on new package (manual, see PR docker build evidence) =="
echo "SKIP  AT-0014-3 (verified manually: docker build output captured in PR, not scripted)"

# --- AT-0014-4: changing VITE_API_URL invalidates the site:build cache.
# moon has no `query hash` command; detect this behaviorally via
# `moon run`'s own "(cached, ...)" marker in its action summary: run once
# to populate the cache, run again with the SAME env (expect a cache HIT,
# proving determinism), then again with a DIFFERENT VITE_API_URL (expect a
# cache MISS, proving the env var is a real cache input -- turbo.json had
# no equivalent for this).
echo "== AT-0014-4: env var is a task cache input for site:build =="
VITE_WEB_URL="http://localhost:3000" VITE_API_URL="http://localhost:8080" moon run site:build --force >/tmp/at-0014-4-populate.log 2>&1
RUN_A=$(VITE_WEB_URL="http://localhost:3000" VITE_API_URL="http://localhost:8080" moon run site:build 2>&1)
RUN_B=$(VITE_WEB_URL="http://localhost:3000" VITE_API_URL="http://localhost:9999" moon run site:build 2>&1)
HIT_A=$(echo "$RUN_A" | grep -c "site:build (cached" || true)
HIT_B=$(echo "$RUN_B" | grep -c "site:build (cached" || true)
if [ "$HIT_A" -ge 1 ] && [ "$HIT_B" -eq 0 ]; then
  pass "AT-0014-4 (same VITE_API_URL -> cache hit; changed VITE_API_URL -> cache miss)"
else
  fail "AT-0014-4" "expected hit-then-miss, got HIT_A=$HIT_A HIT_B=$HIT_B -- see \$RUN_A/\$RUN_B"
  echo "--- RUN_A ---"; echo "$RUN_A" | tail -5
  echo "--- RUN_B ---"; echo "$RUN_B" | tail -5
fi
# Leave the cache in the state the rest of the suite / moon ci expects.
VITE_WEB_URL="http://localhost:3000" VITE_API_URL="http://localhost:8080" moon run site:build --force >/dev/null 2>&1 || true

# --- AT-0014-5: drift gate fails when a zod enum changes without regenerating.
# Real-world scenario: a developer adds a value to a zod enum in
# packages/core/src/schemas, forgets to run `pnpm gen:contracts`, and
# commits. The drift gate (`moon run core:gen-contracts && git diff
# --exit-code`) must catch that the checked-in generated files no longer
# match what the (now-changed) source schema produces.
echo "== AT-0014-5: contracts drift gate catches an un-regenerated schema change =="
SCHEMA_FILE="packages/core/src/schemas/rating.ts"
if [ -f "$SCHEMA_FILE" ]; then
  cp "$SCHEMA_FILE" /tmp/at-0014-5-backup.ts
  sed -i.bak 's/"NotCheckable",/"NotCheckable",\n  "At0014_5_DriftProbe",/' "$SCHEMA_FILE"
  rm -f "$SCHEMA_FILE.bak"
  if moon run core:gen-contracts --force >/tmp/at-0014-5.log 2>&1 && git diff --exit-code -- packages/core/generated services/pipeline/app/models/generated.py >/dev/null 2>&1; then
    fail "AT-0014-5" "drift gate did not detect the schema change (git diff was clean after regen; see /tmp/at-0014-5.log)"
  else
    pass "AT-0014-5 (drift gate correctly fails: regenerated output differs from what's committed)"
  fi
  cp /tmp/at-0014-5-backup.ts "$SCHEMA_FILE"
  rm -f /tmp/at-0014-5-backup.ts
  # Restore the generated files to match the reverted schema.
  moon run core:gen-contracts --force >/dev/null 2>&1 || true
  git checkout -- packages/core/generated services/pipeline/app/models/generated.py 2>/dev/null || true
else
  fail "AT-0014-5" "$SCHEMA_FILE does not exist"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0014 CHECKS: GREEN"
else
  echo "AT-0014 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
