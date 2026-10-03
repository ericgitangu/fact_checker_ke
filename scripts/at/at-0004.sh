#!/usr/bin/env bash
# ADR-0004 acceptance checks (verification pipeline). Run from repo root:
#   bash scripts/at/at-0004.sh
#
# Covers the pipeline-owned rows: AT-0004-C (citation integrity),
# AT-0004-D (dedup negation/number/date/entity guard), and the eval
# harness scaffold feeding AT-0004-E. AT-0004-A/B belong to the API layer
# and editor UI (out of scope for services/pipeline) and are left RED here
# with a note, per the task's file-ownership boundary.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/services/pipeline"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }
note() { echo "NOTE  $1"; }

echo "== AT-0004-C: citation integrity (doc_id in retrieved set + substring match) =="
if uv run pytest -q tests/test_citation_guard.py >/tmp/at-0004-c.log 2>&1; then
  pass "AT-0004-C"
else
  fail "AT-0004-C" "see /tmp/at-0004-c.log"
fi

echo "== AT-0004-D: negation/number/date/entity mismatches block dedup reuse =="
if uv run pytest -q tests/test_dedup_guard.py tests/test_verify_hop.py >/tmp/at-0004-d.log 2>&1; then
  pass "AT-0004-D"
else
  fail "AT-0004-D" "see /tmp/at-0004-d.log"
fi

echo "== AT-0004-E (scaffold only): eval harness runs and reports per-class precision/recall/F1 =="
if uv run python -m app.eval >/tmp/at-0004-e.log 2>&1; then
  pass "AT-0004-E (scaffold: harness runs; 100-claim/30-Sheng threshold gate remains an open AT)"
  cat /tmp/at-0004-e.log
else
  fail "AT-0004-E" "eval harness failed to run, see /tmp/at-0004-e.log"
fi

note "AT-0004-A (quote attribution=unverified, no rating pre-editor-confirm) and"
note "AT-0004-B (named-person draft shows evidence/sources only, rating:null) are"
note "owned by services/api + the editor UI, out of scope for services/pipeline."
note "Left RED/unimplemented here deliberately; this pipeline's analyze hop DOES"
note "set attribution=unverified for video-URL submissions (tests/test_analyze_hop.py)"
note "and verify hop computes a rating internally regardless of named-person status,"
note "relying on the API layer to withhold it pre-approval (see app/stages/verify.py"
note "docstring comment on ADR-0004 amendment #5)."

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "AT-0004: all pipeline-owned rows GREEN"
else
  echo "AT-0004: FAILURES ABOVE"
fi
exit $FAIL
