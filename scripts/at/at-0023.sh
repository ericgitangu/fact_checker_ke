#!/usr/bin/env bash
# ADR-0023 acceptance checks (adversarial AI and abuse). Run from repo root:
#   bash scripts/at/at-0023.sh
#
# Covers the pipeline-owned rows: AT-0023-1 (prompt injection), AT-0023-2
# (citation to unretrieved doc_id rejected), AT-0023-3 (misquoted span
# rejected), AT-0023-4 (negation mismatch blocks dedup reuse), and the
# AT-0005-3 grep backstop (no unpaid Gemini/AI-Studio host usage), which
# ADR-0023 §1 groups under the same architectural-controls umbrella.
# AT-0023-5 (Turnstile admission control) and AT-0023-6's full 100-claim/
# 30-Sheng F1 gate are owned by services/api and the full eval set
# respectively -- left RED here with a note.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/services/pipeline"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }
note() { echo "NOTE  $1"; }

echo "== AT-0023-1: prompt injection never produces a fabricated True rating/citation =="
if uv run pytest -q tests/test_prompt_injection.py >/tmp/at-0023-1.log 2>&1; then
  pass "AT-0023-1 (>=5 adversarial fixtures incl. Swahili, see tests/test_prompt_injection.py)"
else
  fail "AT-0023-1" "see /tmp/at-0023-1.log"
fi

echo "== AT-0023-2 / AT-0023-3: citation integrity (doc_id + quoted_span checks) =="
if uv run pytest -q tests/test_citation_guard.py >/tmp/at-0023-2-3.log 2>&1; then
  pass "AT-0023-2 / AT-0023-3"
else
  fail "AT-0023-2 / AT-0023-3" "see /tmp/at-0023-2-3.log"
fi

echo "== AT-0023-4: negation-mismatch blocks dedup reuse =="
if uv run pytest -q tests/test_dedup_guard.py::test_may_reuse_blocked_by_negation_mismatch_at_0023_4 \
    tests/test_verify_hop.py::test_dedup_does_not_reuse_on_negation_mismatch_at_0023_4 \
    >/tmp/at-0023-4.log 2>&1; then
  pass "AT-0023-4"
else
  fail "AT-0023-4" "see /tmp/at-0023-4.log"
fi

echo "== AT-0005-3 backstop (ADR-0023 §1 architectural-controls umbrella): no unpaid Gemini/AI-Studio host usage =="
FORBIDDEN_HOST="generativelanguage.googleapis.com"
# app/config.py is the one legitimate, documented occurrence of the literal
# (it defines the constant other modules import and compare against).
MATCHES=$(grep -rl --include='*.py' "$FORBIDDEN_HOST" app 2>/dev/null | grep -v '^app/config.py$' || true)
if [ -z "$MATCHES" ]; then
  pass "AT-0005-3 grep backstop (no forbidden host outside app/config.py)"
else
  fail "AT-0005-3 grep backstop" "forbidden host found in: $MATCHES"
fi
if uv run pytest -q tests/test_config_assertions.py >/tmp/at-0005-3.log 2>&1; then
  pass "AT-0005-3 runtime config assertion"
else
  fail "AT-0005-3 runtime config assertion" "see /tmp/at-0005-3.log"
fi

note "AT-0023-5 (Turnstile gates QStash/LLM calls) is owned by services/api"
note "(the submission endpoint), out of scope for services/pipeline. Left RED."
note "AT-0023-6: the >=30-Sheng-item floor is now MET (app/eval/fixtures/"
note "claims.jsonl has 30 of 45 rows labelled lang=sheng, verified via"
note "'uv run python -m app.eval'). The 100-claim total and an agreed launch"
note "F1 threshold remain an explicit open AT, not faked."

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "AT-0023: all pipeline-owned rows GREEN"
else
  echo "AT-0023: FAILURES ABOVE"
fi
exit $FAIL
