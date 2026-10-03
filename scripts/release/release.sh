#!/usr/bin/env bash
# ADR-0016 atomic deploy rail. Runs locally while GitHub Actions is
# billing-locked (same script will run in Actions via WIF once billing
# is restored — no change needed, the rail doesn't know where it runs).
#
# Every step is idempotent and resumable: re-running after a partial
# failure re-does cheap/no-op steps and continues. Nothing here is a
# moon task (infra/ is not matched by .moon/workspace.yml's project
# globs — apps/*, packages/*, services/* only — and adding it would mean
# editing .moon/workspace.yml, which is out of this change's file
# ownership). This script IS the entrypoint ADR-0016 calls
# "moon run infra:release" in its mermaid diagram; that moon task does
# not exist today — see the [DEVIATION] note in the ADR implementation
# notes appended by this change.
#
# Usage:
#   scripts/release/release.sh [--dry-run] [--skip-web]
#
# --dry-run : print the FULL ordered plan — every step from moon ci
#             through vercel promote — without executing ANY billable
#             command, regardless of ENABLE_SERVICES. This is the
#             owner-facing "what would happen" view. Read-only inspection
#             commands (terraform plan, which needs real state/creds to
#             be useful) still run for real even in --dry-run; nothing
#             that creates, pushes, deploys, or shifts traffic ever runs
#             in --dry-run, no exceptions.
#
# Billable-step gate: every step that pushes an image, runs a migration,
# deploys a Cloud Run revision, shifts traffic, or promotes a Vercel
# deployment is gated behind the explicit ENABLE_SERVICES=true
# environment variable (distinct from Terraform's own enable_services
# variable in envs/prod — this script's ENABLE_SERVICES is the owner's
# single kill switch for "actually do billable things", set by the owner
# only). Leaving it unset means: real run, correct plan/lint steps
# execute, but every billable step SKIPs with a stated reason. The owner
# flips ENABLE_SERVICES=true only once ready for the first real deploy —
# see docs/adr/0016's "first deploy sequence" implementation note for the
# exact command.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
SKIP_WEB=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-web) SKIP_WEB=1 ;;
  esac
done

ENABLE_SERVICES="${ENABLE_SERVICES:-}"
REGION="${REGION:-africa-south1}"
PROJECT_ID="${PROJECT_ID:-master-crossing-435409-r1}"

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

step() {
  echo
  echo "=== $1 ==="
}

# billable_gate <description>: decides whether a billable command block
# should actually execute. Returns 0 (proceed) only in a real run with
# ENABLE_SERVICES=true. In --dry-run it ALWAYS prints the plan (via the
# caller using `run`, which is dry-run-aware) and returns 0 so the full
# sequence is visible — `run` guarantees nothing is actually executed.
# In a real run without ENABLE_SERVICES=true, it prints SKIP and returns
# 1 so the caller does not attempt to execute or compute real values
# (e.g. reading terraform output, docker inspect) that would fail.
billable_gate() {
  local desc="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  if [[ "$ENABLE_SERVICES" != "true" ]]; then
    echo "SKIP ($desc): ENABLE_SERVICES is not 'true'. This is a billable step — the owner sets ENABLE_SERVICES=true explicitly for the first real deploy (see docs/adr/0016 implementation notes)."
    return 1
  fi
  return 0
}

ENVDIR="$REPO_ROOT/infra/terraform/envs/prod"
PLAN_OUT="$ENVDIR/plan.out"
PLAN_JSON="$ENVDIR/plan.json"

# Placeholders used only to render a legible --dry-run plan when the
# real value (artifact registry path, image digest) can't be resolved
# without already having pushed something. Never used for an actual
# command — `run` only ever echoes these under --dry-run.
AR_PATH_PLACEHOLDER="${REGION}-docker.pkg.dev/${PROJECT_ID}/fact-checker-ke"
AR_PATH=""
API_DIGEST=""
PIPELINE_DIGEST=""

# --- Step A: moon ci green ---
step "A: moon ci (affected lint/typecheck/test/build)"
if command -v moon >/dev/null 2>&1; then
  run moon ci
else
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] moon ci (moon not on PATH in this shell — would need to run for real before releasing)"
  else
    echo "SKIP: moon not on PATH in this shell — run 'moon ci' manually before releasing."
  fi
fi

# --- Step B: build + push images by digest ---
step "B: build + push images by digest [BILLABLE: Artifact Registry storage + egress]"
if billable_gate "image build/push"; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    AR_PATH="$AR_PATH_PLACEHOLDER"
  else
    AR_PATH=$(cd "$ENVDIR" && terraform output -raw artifact_registry_docker_path 2>/dev/null)
    if [[ -z "$AR_PATH" ]]; then
      echo "SKIP: could not read artifact_registry_docker_path output — run terraform apply on bootstrap/envs-prod first."
    fi
  fi
  if [[ -n "$AR_PATH" ]]; then
    run gcloud auth configure-docker "${AR_PATH%%/*}" --quiet
    run docker build -t "$AR_PATH/api:candidate" -f services/api/Dockerfile .
    run docker push "$AR_PATH/api:candidate"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      API_DIGEST="$AR_PATH/api@sha256:<resolved-after-real-push>"
    else
      API_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$AR_PATH/api:candidate" 2>/dev/null || true)
    fi
    echo "api image by digest: ${API_DIGEST:-<unavailable>}"

    run docker build -t "$AR_PATH/pipeline:candidate" -f services/pipeline/Dockerfile .
    run docker push "$AR_PATH/pipeline:candidate"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      PIPELINE_DIGEST="$AR_PATH/pipeline@sha256:<resolved-after-real-push>"
    else
      PIPELINE_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$AR_PATH/pipeline:candidate" 2>/dev/null || true)
    fi
    echo "pipeline image by digest: ${PIPELINE_DIGEST:-<unavailable>}"
  fi
fi

# --- Step C: terraform plan + plan-guard ---
step "C: terraform plan + plan-guard [read-only — always runs, even in --dry-run]"
(
  cd "$ENVDIR"
  run terraform init -input=false
  run terraform plan -input=false -out=plan.out
  if [[ "$DRY_RUN" -eq 0 ]]; then
    terraform show -json plan.out > plan.json
  fi
)
if [[ "$DRY_RUN" -eq 0 ]]; then
  bash "$REPO_ROOT/infra/terraform/policy/plan-guard.sh" "$PLAN_JSON"
  GUARD_EXIT=$?
  if [[ "$GUARD_EXIT" -ne 0 ]]; then
    echo "ABORT: plan-guard rejected the plan. See violations above. No deploy steps will run."
    exit 1
  fi
else
  echo "[dry-run] bash $REPO_ROOT/infra/terraform/policy/plan-guard.sh $PLAN_JSON"
fi

# --- Step D: migration lint, then migrate job ---
step "D: expand/contract migration lint"
run bash "$REPO_ROOT/scripts/release/migration-lint.sh"
LINT_EXIT=$?
if [[ "$LINT_EXIT" -ne 0 && "$DRY_RUN" -eq 0 ]]; then
  echo "ABORT: a destructive migration is missing its '-- contract: ADR-XXXX' marker. No deploy steps will run."
  exit 1
fi

step "D: migrate job (EXPAND-only migrations against the direct Neon connection) [BILLABLE: Cloud Run Job execution]"
if billable_gate "migrate job"; then
  run gcloud run jobs execute fact-checker-ke-migrate --region="$REGION" --wait
fi

# --- Step E: deploy --no-traffic, tag=candidate ---
step "E: deploy new revisions --no-traffic, tag=candidate [BILLABLE: Cloud Run deploy]"
if billable_gate "candidate deploy"; then
  API_IMAGE_REF="${API_DIGEST:-$AR_PATH_PLACEHOLDER/api@sha256:<unresolved>}"
  PIPELINE_IMAGE_REF="${PIPELINE_DIGEST:-$AR_PATH_PLACEHOLDER/pipeline@sha256:<unresolved>}"
  run gcloud run deploy fact-checker-ke-api \
    --image="$API_IMAGE_REF" \
    --region="$REGION" --no-traffic --tag=candidate --quiet
  run gcloud run deploy fact-checker-ke-pipeline \
    --image="$PIPELINE_IMAGE_REF" \
    --region="$REGION" --no-traffic --tag=candidate --quiet
fi

# --- Step F: smoke candidate URL ---
step "F: smoke candidate (healthz — must NOT touch the DB, ADR-0016 amendment)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] CANDIDATE_URL=\$(gcloud run services describe fact-checker-ke-api --region=$REGION --format='value(status.traffic[0].url)')"
  echo "[dry-run] curl -fsS --max-time 10 \"\$CANDIDATE_URL/healthz\""
  echo "[dry-run] on failure: ABORT, traffic stays on the previous revision (AT-0016-3)."
elif [[ "$ENABLE_SERVICES" != "true" ]]; then
  echo "SKIP: no candidate URL yet (ENABLE_SERVICES is not 'true')."
else
  CANDIDATE_URL=$(gcloud run services describe fact-checker-ke-api --region="$REGION" --format='value(status.traffic[0].url)' 2>/dev/null)
  if [[ -z "$CANDIDATE_URL" ]]; then
    echo "ABORT: could not resolve candidate URL — leaving traffic on the previous revision (AT-0016-3 behaviour)."
    exit 1
  fi
  if run curl -fsS --max-time 10 "$CANDIDATE_URL/healthz"; then
    echo "smoke PASS"
  else
    echo "ABORT: healthz smoke failed. Traffic stays on the previous revision — no traffic shift, no promote."
    exit 1
  fi
fi

# --- Step G: shift 100% traffic to candidate ---
step "G: update-traffic 100% to candidate [BILLABLE: traffic shift, instant/free itself but gates live billable traffic]"
if billable_gate "traffic shift"; then
  run gcloud run services update-traffic fact-checker-ke-api --region="$REGION" --to-tags=candidate=100
  run gcloud run services update-traffic fact-checker-ke-pipeline --region="$REGION" --to-tags=candidate=100
fi

# --- Step H/I/J: Vercel build + deploy --prebuilt + promote ---
if [[ "$SKIP_WEB" -eq 1 ]]; then
  step "H-J: Vercel (web/site) — skipped via --skip-web"
else
  step "H: vercel build + deploy --prebuilt (web) [BILLABLE: Vercel build minutes]"
  if ! command -v vercel >/dev/null 2>&1; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "[dry-run] vercel build --prod && vercel deploy --prebuilt (vercel CLI not found in this shell — would need to be installed for a real run)"
    else
      echo "SKIP: vercel CLI not found."
    fi
  elif [[ "$DRY_RUN" -eq 0 && ! -f "$REPO_ROOT/apps/web/.vercel/project.json" ]]; then
    echo "SKIP: apps/web is not vercel-linked yet (no .vercel/project.json). Run 'vercel link' there first — documented as [MANUAL]."
  else
    (
      cd "$REPO_ROOT/apps/web" 2>/dev/null || cd "$REPO_ROOT"
      run vercel build --prod
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run] PREVIEW_URL=\$(vercel deploy --prebuilt)"
        step "I: smoke preview URL"
        echo "[dry-run] curl -fsS --max-time 10 \"\$PREVIEW_URL\""
        step "J: vercel promote [BILLABLE: production alias flip]"
        echo "[dry-run] vercel promote \"\$PREVIEW_URL\""
      else
        PREVIEW_URL=$(run vercel deploy --prebuilt 2>&1 | tail -1)
        step "I: smoke preview URL"
        if [[ -n "$PREVIEW_URL" ]] && run curl -fsS --max-time 10 "$PREVIEW_URL"; then
          step "J: vercel promote [BILLABLE: production alias flip]"
          run vercel promote "$PREVIEW_URL"
        else
          echo "ABORT: web preview smoke failed. Prod alias unchanged (AT matching ADR-0016's F-fail/I-fail path)."
          exit 1
        fi
      fi
    )
  fi

  if [[ "$DRY_RUN" -eq 0 && ! -f "$REPO_ROOT/apps/site/.vercel/project.json" ]]; then
    echo "SKIP: apps/site is not vercel-linked yet — documented as [MANUAL]."
  elif [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] (apps/site follows the same build/deploy/smoke/promote sequence as apps/web, once vercel-linked)"
  fi
fi

echo
echo "=== release.sh complete ==="
