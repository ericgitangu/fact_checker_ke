# ADR-0016: Atomic deploy rail and IaC (Terraform), scale-to-zero only

**Status:** Proposed · **Date:** 2026-10-03

## Problem
We need a single, repeatable release path with atomic cut-over and instant rollback across Cloud Run and Vercel. It must enforce, mechanically, the owner's hard rule: **never provision always-on resources**.

## IaC layout (Terraform 1.5.7, pinned)
```
infra/terraform/
  bootstrap/   # one-time: GCS state bucket (versioned), Workload Identity Federation for GitHub, deploy SA
  modules/     # cloud_run_service, cloud_run_job, secret (container only), artifact_registry
  envs/prod/   # composes modules; remote state in GCS
  policy/      # plan guard (see below)
```
- **Providers [V]:**
  - `hashicorp/google` 8.x: `cloud_run_v2_service`/`_job`, `artifact_registry_repository`, `secret_manager_secret`, WIF
  - `kislerdm/neon` 0.18: `neon_project`, `neon_branch`
  - `upstash/upstash` 2.1: `upstash_redis_database`, plus QStash schedule and topic resources
  - The Vercel Terraform provider is **not adopted** (unverified). Vercel projects are managed by CLI.
- **Import, don't recreate:** the existing Neon project `fact-checker-ke` and Upstash database `fact-checker-ke` are brought under state with `terraform import`.
- **Secrets:** Terraform creates secret *containers* and IAM bindings only. **Secret values never enter Terraform state.** Values are added with `gcloud secrets versions add` from stdin, which is the established no-echo runbook.
- **Least privilege:**
  - the API service account gets `secretAccessor` on its own secrets
  - the pipeline service account likewise
  - only the QStash-signed path can invoke the pipeline: ingress is internal plus a public URL with signature verification. The exact ingress mode is chosen at implementation.

## Scale-to-zero policy as code (blocking)
`policy/plan-guard.sh` runs on `terraform show -json plan.out` and **fails the rail** if the plan contains any of:
- `google_cloud_run_v2_service` with `scaling.min_instance_count > 0`
- a Cloud Run setting of "CPU always allocated" (`cpu_idle = false`)
- `google_compute_instance`, `google_compute_router_nat`, `google_compute_address` (unattached EIP equivalent)
- `google_sql_database_instance`, `google_redis_instance` (Memorystore), `google_vpc_access_connector`
- any `google_container_cluster`

It also reports the estimated monthly delta. A GCP **billing budget** with alerts at $1, $5 and $10 is part of `envs/prod`.

## The rail: atomic, ordered, reversible
```mermaid
flowchart LR
  A[moon ci green] --> B[build images via moon docker<br/>push by DIGEST]
  B --> C[terraform plan + plan-guard]
  C --> D[migrate job:<br/>EXPAND-only migrations]
  D --> E[deploy new revisions<br/>--no-traffic, tag=candidate]
  E --> F{smoke candidate URL<br/>healthz, submit, SSE}
  F -- pass --> G[shift 100% traffic<br/>to candidate]
  F -- fail --> R[stop: traffic stays on<br/>previous revision]
  G --> H[vercel build --prod<br/>deploy --prebuilt]
  H --> I{smoke preview URL}
  I -- pass --> J[vercel promote]
  I -- fail --> R2[stop: prod alias unchanged]
```
- **Atomicity:**
  - Cloud Run: deploy `--no-traffic` plus a tag, then `update-traffic` **[V]**. Rollback is re-pointing traffic to the previous revision, with no rebuild.
  - Vercel: deploy without assigning the production alias, smoke-test, then `vercel promote` **[V: promote/rollback]**. The exact flag to stage a prod build without the domain **[to verify at implementation]**.
- **Migrations use expand and contract.** A release may only *add*: nullable or defaulted columns, new tables, new enum values. Destructive changes (drop, rename, `NOT NULL` on existing data) ship in a *later* release, once no deployed revision reads the old shape. CI checks drizzle migration SQL for `DROP`, `RENAME` and `ALTER … SET NOT NULL` and requires a `-- contract:` marker plus an ADR reference.
- **Order:** backend before frontend. New API revisions must accept the previous web and mobile clients (additive API changes only, with `/v1` stability).
- **Where it runs:** `moon run infra:release` (one script, the same steps everywhere). It runs locally while GitHub Actions is billing-locked, then in Actions using WIF (no long-lived keys).
- **Images are referenced by digest**, never `:latest`, so Terraform state records exactly what is live.

## Trade-offs accepted
- Two deploy targets.
- Manual promotion on Vercel Hobby (one-step rollback only **[V]**).
- Expand and contract doubles migration work for destructive changes.

## Irreversible / hard to undo
- Terraform-importing the live Neon project: a mistaken `destroy` would delete data. Set `prevent_destroy` on Neon and Upstash resources.
- Neon point-in-time restore exists, but don't rely on it as a plan.

## Review trigger
Revisit if Actions is restored (move the rail to CI), on the first failed promotion (post-mortem the rail), or when a second environment (staging) is justified.

## Acceptance tests
| ID | Behaviour |
|---|---|
| AT-0016-1 | plan-guard fails a plan with `min_instance_count = 1` and passes the real prod plan |
| AT-0016-2 | After the rail, `gcloud run services describe` shows min=0 on every service |
| AT-0016-3 | A failed candidate smoke leaves 100% traffic on the previous revision (forced-failure drill) |
| AT-0016-4 | A migration containing `DROP COLUMN` without a `-- contract:` marker fails CI |
| AT-0016-5 | `terraform plan` on an unchanged tree reports no changes (state matches the imported Neon/Upstash) |
| AT-0016-6 | No secret value appears in `terraform show -json` output (grep check) |
