#!/usr/bin/env bash
# ADR-0016 acceptance tests. Run from repo root:
#   bash scripts/at/at-0016.sh
#
# Each AT prints PASS/FAIL/SKIP. Non-zero exit if any AT fails (SKIPs
# don't fail the suite — they're deferred until enable_services per the
# ADR's own gating). Idempotent: running twice produces the same result
# (AT-0016-5 is explicitly a "run plan twice" check).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

TF_DIR="$REPO_ROOT/infra/terraform/envs/prod"
POLICY_DIR="$REPO_ROOT/infra/terraform/policy"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }
skip() { echo "SKIP  $1: $2"; }

# --- AT-0016-1: plan-guard fails a plan with min_instance_count=1 and
#     passes the real prod plan ---
echo "== AT-0016-1: plan-guard RED (violating fixture) + GREEN (clean fixture) =="
if bash "$POLICY_DIR/plan-guard.sh" "$POLICY_DIR/fixtures/violating-plan.json" >/tmp/at-0016-1-red.log 2>&1; then
  fail "AT-0016-1 (RED)" "plan-guard PASSED a violating fixture — should have failed. See /tmp/at-0016-1-red.log"
else
  pass "AT-0016-1 (RED half — violating fixture correctly rejected)"
fi
if bash "$POLICY_DIR/plan-guard.sh" "$POLICY_DIR/fixtures/clean-plan.json" >/tmp/at-0016-1-green.log 2>&1; then
  pass "AT-0016-1 (GREEN half — clean fixture correctly accepted)"
else
  fail "AT-0016-1 (GREEN)" "plan-guard rejected a clean fixture. See /tmp/at-0016-1-green.log"
fi

# --- AT-0016-1b: plan-guard rejects global LB resources ---
echo "== AT-0016-1b: plan-guard rejects global_forwarding_rule/url_map/backend_service =="
GUARD_OUTPUT="$(bash "$POLICY_DIR/plan-guard.sh" "$POLICY_DIR/fixtures/violating-plan.json" 2>&1 || true)"
if grep -q "global_forwarding_rule" "$POLICY_DIR/fixtures/violating-plan.json" && \
   echo "$GUARD_OUTPUT" | grep -q "global load-balancer"; then
  pass "AT-0016-1b (fixture coverage)"
else
  fail "AT-0016-1b" "fixture doesn't exercise the global-LB rejection path"
fi

# --- AT-0016-1 (real plan): run plan-guard against the actual prod plan ---
echo "== AT-0016-1 (real): plan-guard against infra/terraform/envs/prod's real plan =="
if command -v terraform >/dev/null 2>&1 && [[ -d "$TF_DIR" ]]; then
  (
    cd "$TF_DIR"
    terraform init -input=false >/tmp/at-0016-tf-init.log 2>&1
    terraform plan -input=false -out=/tmp/at-0016-plan.out >/tmp/at-0016-tf-plan.log 2>&1
    terraform show -json /tmp/at-0016-plan.out > /tmp/at-0016-plan.json 2>/dev/null
  )
  if [[ -f /tmp/at-0016-plan.json ]] && bash "$POLICY_DIR/plan-guard.sh" /tmp/at-0016-plan.json; then
    pass "AT-0016-1 (real prod plan passes plan-guard)"
  else
    fail "AT-0016-1 (real)" "plan-guard rejected the real envs/prod plan — see /tmp/at-0016-tf-plan.log"
  fi
else
  skip "AT-0016-1 (real)" "terraform not on PATH or infra/terraform/envs/prod missing"
fi

# --- AT-0016-2: deferred until enable_services ---
echo "== AT-0016-2: gcloud run services describe shows min=0 =="
skip "AT-0016-2" "deferred — enable_services=false (no images pushed yet); will run post-wave-2"

# --- AT-0016-3: forced-failure smoke drill ---
echo "== AT-0016-3: failed candidate smoke leaves traffic on previous revision =="
skip "AT-0016-3" "deferred — enable_services=false; release.sh's Step F already implements the abort-on-smoke-fail behaviour (no update-traffic call on failure) — re-run this AT once services exist"

# --- AT-0016-4: migration lint ---
echo "== AT-0016-4: expand/contract migration lint (DROP/RENAME/SET NOT NULL without -- contract:) =="
if bash "$REPO_ROOT/scripts/release/migration-lint.sh"; then
  pass "AT-0016-4 (current db/migrations/ — vacuously true, no migrations yet)"
else
  fail "AT-0016-4" "migration-lint found an unmarked destructive migration"
fi

# --- AT-0016-5: terraform plan on an unchanged tree shows no changes ---
echo "== AT-0016-5: terraform plan (idempotent, no changes) =="
if [[ -d "$TF_DIR" ]]; then
  (
    cd "$TF_DIR"
    terraform plan -input=false -detailed-exitcode >/tmp/at-0016-5.log 2>&1
  )
  EXITCODE=$?
  if [[ "$EXITCODE" -eq 0 ]]; then
    pass "AT-0016-5 (plan reports no changes)"
  elif [[ "$EXITCODE" -eq 2 ]]; then
    fail "AT-0016-5" "plan reports pending changes — state has drifted from config. See /tmp/at-0016-5.log"
  else
    fail "AT-0016-5" "terraform plan errored (exit $EXITCODE). See /tmp/at-0016-5.log"
  fi
else
  skip "AT-0016-5" "infra/terraform/envs/prod missing"
fi

# --- AT-0016-6: no secret value in terraform show -json ---
echo "== AT-0016-6: no secret VALUE in terraform state/plan output =="
if [[ -d "$TF_DIR" ]]; then
  (
    cd "$TF_DIR"
    terraform state pull > /tmp/at-0016-6-state.json 2>/tmp/at-0016-6-state.err
  )
  if [[ -s /tmp/at-0016-6-state.json ]]; then
    # Known real-world secret-value shapes to grep for: Upstash/Neon
    # connection strings and tokens. A match here is a hard failure.
    if grep -qE "postgres(ql)?://[^@\"]+:[^@\"]+@|\"password\"\s*:\s*\"[A-Za-z0-9+/_-]{15,}\"|\"rest_token\"\s*:\s*\"[A-Za-z0-9+/_-]{15,}\"" /tmp/at-0016-6-state.json; then
      fail "AT-0016-6" "a secret VALUE pattern matched in terraform state — see /tmp/at-0016-6-state.json (do not commit this file; treat as sensitive, delete after inspection)"
    else
      pass "AT-0016-6 (no secret value pattern found in current state)"
    fi
  else
    skip "AT-0016-6" "could not pull state (see /tmp/at-0016-6-state.err)"
  fi
  rm -f /tmp/at-0016-6-state.json
else
  skip "AT-0016-6" "infra/terraform/envs/prod missing"
fi

# --- AT-0016-7: healthz doesn't touch DB, sweeper >= 60min ---
echo "== AT-0016-7: healthz DB-free, sweeper interval >= 60min, 24h idle soak shows Neon suspended =="
skip "AT-0016-7" "deferred — services/api healthz and the ADR-0017 sweeper are application-layer, not yet implemented (wave-2)"

# --- AT-0016-8: WIF condition pins repo + ref, fork-PR can't mint a token ---
echo "== AT-0016-8: WIF provider condition pins repository_owner + ref==refs/heads/main =="
if command -v gcloud >/dev/null 2>&1; then
  CONDITION=$(gcloud iam workload-identity-pools providers describe github \
    --project=master-crossing-435409-r1 \
    --workload-identity-pool=github-actions \
    --location=global \
    --format='value(attributeCondition)' 2>/tmp/at-0016-8.err)
  if echo "$CONDITION" | grep -q "repository_owner" && echo "$CONDITION" | grep -q "refs/heads/main"; then
    pass "AT-0016-8 (WIF attribute_condition pins repository_owner + refs/heads/main)"
  else
    fail "AT-0016-8" "WIF condition missing repository_owner or ref pin: '$CONDITION' (see /tmp/at-0016-8.err)"
  fi
else
  skip "AT-0016-8" "gcloud not on PATH"
fi

echo
if [[ "$FAIL" -eq 1 ]]; then
  echo "=== AT-0016: one or more acceptance tests FAILED ==="
  exit 1
fi
echo "=== AT-0016: all runnable acceptance tests PASSED (see SKIP lines for deferred ones) ==="
