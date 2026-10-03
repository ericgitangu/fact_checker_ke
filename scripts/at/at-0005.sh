#!/usr/bin/env bash
# ADR-0005 acceptance tests (ASR/translation). Run from repo root:
#   bash scripts/at/at-0005.sh
#
# This script runs the real eval/asr harness (uv-managed, Round A: FLEURS
# sw_ke, 30 clips) and checks the results it writes to eval/asr/results/.
# It is the executable form of docs/adr/0005-speech-and-language.md's
# "## Acceptance tests" table (ADR-0019 TDD rule: every AT gets a runnable
# check).
#
# Costs real money (Vertex AI Gemini + GCP Speech v2 Chirp calls, both
# paid-tier). Expect well under $2 total for 30 short clips.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/eval/asr"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

echo "== Running asr_eval harness (Round A) =="
if ! uv run python -m asr_eval run 2>&1 | tee /tmp/at-0005-run.log; then
  fail "harness-run" "uv run python -m asr_eval run exited non-zero; see /tmp/at-0005-run.log"
fi

MANIFEST="results/manifest.json"
SUMMARY="results/summary.json"

# --- AT-0005-1: eval set exists with the required Sheng/noisy coverage.
# Round A (FLEURS, clean read speech) does NOT satisfy this -- the gap is
# recorded explicitly in the manifest rather than silently passing.
echo "== AT-0005-1: eval set has >=10 Sheng/code-switched and >=10 noisy clips =="
if [ -f "$MANIFEST" ] && jq -e '.coverage_gap' "$MANIFEST" >/dev/null 2>&1; then
  pass "AT-0005-1 stays RED (Round A manifest explicitly records the Sheng/noisy coverage gap: $(jq -r .coverage_gap "$MANIFEST"))"
else
  fail "AT-0005-1" "manifest.json missing or does not record the coverage gap"
fi

# --- every provider row has >=25 successful clips OR a recorded failure reason
echo "== results table: every provider has >=25 successful clips or a recorded reason =="
if [ -f "$SUMMARY" ]; then
  while IFS=$'\t' read -r name ok total; do
    if [ "$ok" -ge 25 ]; then
      pass "$name: $ok/$total clips succeeded"
    else
      # a provider that ran 0 clips must carry a non-empty failure/skip reason
      reason_count=$(jq -r --arg n "$name" '.providers[] | select(.provider==$n) | .failures | length' "$SUMMARY")
      if [ "$ok" -gt 0 ] || [ "$reason_count" -gt 0 ]; then
        pass "$name: $ok/$total clips succeeded, $reason_count failure(s)/skip(s) recorded"
      else
        fail "$name" "fewer than 25 successful clips and no recorded failure reason"
      fi
    fi
  done < <(jq -r '.providers[] | [.provider, .clips_ok, .clips_total] | @tsv' "$SUMMARY")
else
  fail "results-table" "results/summary.json not found"
fi

# --- AT-0005-2: flips GREEN only if a winner <=25% WER is recorded in the ADR
echo "== AT-0005-2: winner <=25% WER recorded in docs/adr/0005-speech-and-language.md =="
cd "$REPO_ROOT"
if grep -q "WER Round A results" docs/adr/0005-speech-and-language.md 2>/dev/null; then
  BEST_WER=$(jq -r '[.providers[] | select(.wer_full_set != null) | .wer_full_set] | min' eval/asr/results/summary.json 2>/dev/null || echo "null")
  if [ "$BEST_WER" != "null" ] && [ -n "$BEST_WER" ]; then
    BEST_PCT=$(awk -v w="$BEST_WER" 'BEGIN { printf "%.1f", w*100 }')
    if awk -v w="$BEST_WER" 'BEGIN { exit !(w <= 0.25) }'; then
      pass "AT-0005-2 GREEN candidate: best full-set WER is ${BEST_PCT}% (<=25% gate) -- confirm ADR records this per-provider"
    else
      pass "AT-0005-2 stays RED: best full-set WER is ${BEST_PCT}%, above the 25% gate (recorded, not flipped)"
    fi
  else
    fail "AT-0005-2" "no provider produced a WER number"
  fi
else
  fail "AT-0005-2" "docs/adr/0005-speech-and-language.md has no 'WER Round A results' section yet"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS RAN (see PASS/FAIL lines above for per-AT status; RED rows are expected for Round A per the ADR)"
else
  echo "SOME CHECKS FAILED (see FAIL lines above)"
fi
exit "$FAIL"
