/**
 * Neon project `fact-checker-ke` (id ancient-art-69043280) — IMPORTED,
 * never recreated. `prevent_destroy` per ADR-0016 ("a mistaken destroy
 * would delete data"). This module declares the resources Terraform will
 * bring under management; the actual `terraform import` (or TF 1.5+
 * `import {}` blocks) is wired in envs/prod/imports.tf, gated behind
 * var.enable_neon_import so a missing NEON_API_KEY never breaks a plan
 * for the rest of the stack (see infra/terraform/envs/prod/README or the
 * [MANUAL] note in the ADR implementation notes).
 *
 * Provider: kislerdm/neon 0.18 (ADR-0016). Auth: NEON_API_KEY env var — a
 * Neon *personal API key*, distinct from neonctl's browser-OAuth session
 * token. [MANUAL]: generate one at
 * https://console.neon.tech/app/settings/api-keys (neonctl has no CLI
 * subcommand to mint one non-interactively — verified: `neonctl` only
 * exposes auth/me/orgs/projects/branches/databases/roles/operations/
 * connection-string/set-context/init/completion, no api-key management).
 */

resource "neon_project" "this" {
  count = var.enable_import ? 1 : 0

  name      = var.project_name
  region_id = var.region_id

  # DEVIATION, empirically found: kislerdm/neon 0.18's neon_project
  # resource schema does not expose a `default_endpoint_settings` block
  # (terraform validate rejects it as "Unsupported block type" against
  # the real 0.18.0 schema installed this session) — the min/max
  # autoscaling CU values observed live (0.25/0.25) are therefore left
  # as provider defaults rather than pinned here. Re-check the installed
  # schema (`terraform providers schema -json`) before the [MANUAL] Neon
  # import, in case a differently-named attribute exists.

  lifecycle {
    prevent_destroy = true
  }
}

variable "enable_import" {
  description = "Gate so this module can be loaded (and the rest of envs/prod planned) even without NEON_API_KEY. Flip true once the [MANUAL] API key step is done."
  type        = bool
  default     = false
}

# Both branches are IMPORTED alongside the project, never created — a
# `neon_branch` resource with no matching import would try to create a
# THIRD branch next to the live main/dev. default=false (main) matches
# the observed project.default_endpoint_settings owner; "dev" is a plain
# child branch off main.
resource "neon_branch" "main" {
  count      = var.enable_import ? 1 : 0
  project_id = neon_project.this[0].id
  name       = "main"

  lifecycle {
    prevent_destroy = true
  }
}

resource "neon_branch" "dev" {
  count      = var.enable_import ? 1 : 0
  project_id = neon_project.this[0].id
  parent_id  = neon_branch.main[0].id
  name       = "dev"

  lifecycle {
    prevent_destroy = true
  }
}

output "project_id" {
  value = var.enable_import ? neon_project.this[0].id : var.project_id
}

output "main_branch_id" {
  value = var.enable_import ? neon_branch.main[0].id : var.main_branch_id
}

output "dev_branch_id" {
  value = var.enable_import ? neon_branch.dev[0].id : var.dev_branch_id
}
