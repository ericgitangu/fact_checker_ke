#!/usr/bin/env bash
# ADR-0006 acceptance checks (synthetic media / deepfake handling). Run
# from repo root:
#   bash scripts/at/at-0006.sh
#
# AT-0006 core assertion: "deepfake" is never shown on a detector score
# alone -- the output label allowlist is closed by construction
# (app/stages/synthetic_media_triage.py:TriageLabel) and tested for the
# literal absence of the word "deepfake" across every label the enum can
# produce, plus end-to-end through the real /hops/synthetic-media-triage
# route. Also covers: provenance (C2PA) signal #1, earlier-copy signal #3
# taking priority over a detector score, and the ADR-0006 round-2 rule
# that Rekognition/Vision are never used for authenticity (grep backstop:
# no aws/boto3 Rekognition or google.cloud.vision import anywhere in the
# synthetic-media-triage module).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/services/pipeline"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }
note() { echo "NOTE  $1"; }

echo "== AT-0006: label allowlist excludes 'deepfake' on a detector score alone =="
if uv run pytest -q tests/test_synthetic_media_triage.py >/tmp/at-0006-label.log 2>&1; then
  pass "AT-0006 (label allowlist + detector-score-alone never produces 'deepfake')"
else
  fail "AT-0006 label allowlist" "see /tmp/at-0006-label.log"
fi

echo "== AT-0006: C2PA provenance read (signal #1), local-only, no network =="
if uv run pytest -q tests/test_provenance.py >/tmp/at-0006-provenance.log 2>&1; then
  pass "AT-0006 provenance (C2PA manifest read)"
else
  fail "AT-0006 provenance" "see /tmp/at-0006-provenance.log"
fi

echo "== AT-0006: end-to-end /hops/synthetic-media-triage route =="
if uv run pytest -q tests/test_hops_media.py::test_hop_synthetic_media_triage_no_signal_label_has_no_deepfake_wording \
    >/tmp/at-0006-hop.log 2>&1; then
  pass "AT-0006 hop route"
else
  fail "AT-0006 hop route" "see /tmp/at-0006-hop.log"
fi

echo "== ADR-0006 round-2: Rekognition/Vision are never used for authenticity =="
# Grep for actual import/SDK-usage lines only (not prose mentioning the
# rule by name, which several docstrings in this change do deliberately).
MATCHES=$(grep -rnE '^\s*(import boto3|from boto3|import .*rekognition|from .*rekognition|from google\.cloud import vision|import google\.cloud\.vision)' \
  --include='*.py' app 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  pass "no Rekognition/Vision import anywhere in app/"
else
  fail "Rekognition/Vision grep backstop" "forbidden import found: $MATCHES"
fi

echo "== ADR-0006 scope note: no live detector/vendor keys (HARD RULE) =="
# Same shape: only flag an actual import/client-construction line, not a
# docstring prose mention of why we're NOT using a vendor.
MATCHES=$(grep -rnE '^\s*(import|from) .*(reality_defender|realitydefender|hive_ai)' \
  --include='*.py' app 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  pass "no commercial detector vendor import wired into app/"
else
  fail "vendor-name grep backstop" "unexpected import found: $MATCHES"
fi

note "C2PA signal #2 (SynthID) is NOT implemented -- waitlist-only, no public"
note "API as of ADR-0006's round-2 research. Documented gap, not faked."
note "Reverse-image/earlier-copy search (signal #3) is a Protocol stub"
note "(app/protocols/reverse_image.py) -- FakeReverseImageSearch never makes"
note "a network call; a real vendor integration is future work."
note "Detector-based triage (signal #4) is scoped to upload-only/owner-"
note "authorized media per ADR-0006's red-team amendment; this script does"
note "not enforce that scoping (an API-layer/submission-routing concern)."

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "AT-0006: all pipeline-owned rows GREEN"
else
  echo "AT-0006: FAILURES ABOVE"
fi
exit $FAIL
