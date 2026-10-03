#!/usr/bin/env bash
# ADR-0016 policy/plan-guard.sh — AT-0016-1 / AT-0016-1b.
#
# Usage: plan-guard.sh <plan.json>
#   <plan.json> is the output of `terraform show -json plan.out`.
#
# Fails (exit 1) the rail if the plan contains any always-on or
# never-allowed resource/attribute. Exits 0 and prints a clean summary
# otherwise. Prints an estimated monthly cost-delta HINT (coarse, not a
# bill) for anything it flags.
set -uo pipefail

PLAN_JSON="${1:-}"
if [[ -z "$PLAN_JSON" || ! -f "$PLAN_JSON" ]]; then
  echo "usage: plan-guard.sh <plan.json>" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "plan-guard.sh requires jq" >&2
  exit 2
fi

FAIL=0
VIOLATIONS=()

# jq helper: every resource_changes entry whose change.after (or planned
# `after`) is being created/updated to a disallowed shape. We check both
# `.change.after` and `.change.after_unknown`-tolerant fields; values
# that are null/absent are treated as not-violating (jq `//` default).

add_violation() {
  VIOLATIONS+=("$1")
  FAIL=1
}

# 1. Cloud Run min_instance_count > 0
MIN_INSTANCES_HITS=$(jq -r '
  [.resource_changes[]? |
    select(.type == "google_cloud_run_v2_service") |
    select((.change.after.template[0].scaling[0].min_instance_count // 0) > 0) |
    .address
  ] | .[]
' "$PLAN_JSON" 2>/dev/null)
if [[ -n "$MIN_INSTANCES_HITS" ]]; then
  while IFS= read -r addr; do
    add_violation "min_instance_count > 0 on $addr (always-on Cloud Run — ~\$15-50+/mo depending on CPU/mem, never scales to zero)"
  done <<< "$MIN_INSTANCES_HITS"
fi

# 2. Cloud Run cpu_idle = false ("CPU always allocated")
CPU_IDLE_HITS=$(jq -r '
  [.resource_changes[]? |
    select(.type == "google_cloud_run_v2_service") |
    select(.change.after.template[0].containers[0].resources[0].cpu_idle == false) |
    .address
  ] | .[]
' "$PLAN_JSON" 2>/dev/null)
if [[ -n "$CPU_IDLE_HITS" ]]; then
  while IFS= read -r addr; do
    add_violation "cpu_idle = false on $addr (CPU always allocated — billed even while idle)"
  done <<< "$CPU_IDLE_HITS"
fi

# 3-9. Hard-banned resource types, always-on by construction.
BANNED_TYPES=(
  google_compute_instance
  google_compute_router_nat
  google_compute_address
  google_sql_database_instance
  google_redis_instance
  google_vpc_access_connector
  google_container_cluster
  google_compute_global_forwarding_rule
  google_compute_url_map
  google_compute_backend_service
)

for t in "${BANNED_TYPES[@]}"; do
  HITS=$(jq -r --arg t "$t" '
    [.resource_changes[]? |
      select(.type == $t) |
      select(.change.actions != ["delete"] and .change.actions != ["no-op"]) |
      .address
    ] | .[]
  ' "$PLAN_JSON" 2>/dev/null)
  if [[ -n "$HITS" ]]; then
    while IFS= read -r addr; do
      case "$t" in
        google_compute_global_forwarding_rule|google_compute_url_map|google_compute_backend_service)
          add_violation "$t ($addr) — global load-balancer resource, always-on (~\$18+/mo), ADR-0016 red-team amendment"
          ;;
        google_compute_address)
          add_violation "$t ($addr) — static/reserved IP, ~\$3.6-7/mo if unattached or reserved"
          ;;
        google_compute_router_nat)
          add_violation "$t ($addr) — NAT Gateway, ~\$32/mo baseline (the #1 serverless cost trap)"
          ;;
        google_sql_database_instance)
          add_violation "$t ($addr) — Cloud SQL, always-on DB instance; this stack uses Neon (scale-to-zero) instead"
          ;;
        google_redis_instance)
          add_violation "$t ($addr) — Memorystore, always-on; this stack uses Upstash (scale-to-zero) instead"
          ;;
        google_vpc_access_connector)
          add_violation "$t ($addr) — VPC connector, has a minimum always-on instance count"
          ;;
        google_container_cluster)
          add_violation "$t ($addr) — GKE cluster, always-on control plane + nodes"
          ;;
        google_compute_instance)
          add_violation "$t ($addr) — a persistent VM, always billed while running"
          ;;
      esac
    done <<< "$HITS"
  fi
done

echo "=== plan-guard: $PLAN_JSON ==="
if [[ "$FAIL" -eq 1 ]]; then
  echo "FAIL — ${#VIOLATIONS[@]} violation(s):"
  for v in "${VIOLATIONS[@]}"; do
    echo "  - $v"
  done
  exit 1
fi

echo "PASS — no always-on or banned resources in plan."
exit 0
