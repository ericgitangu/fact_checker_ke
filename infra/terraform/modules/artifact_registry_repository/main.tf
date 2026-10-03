variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "repository_id" {
  type    = string
  default = "fact-checker-ke"
}

resource "google_artifact_registry_repository" "this" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "fact_checker_ke container images, referenced by digest (ADR-0016)."

  # No cost guardrail concept applies here (storage-only, billed per GB,
  # no always-on compute) — nothing for plan-guard to police.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-last-20-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s" # 30 days
    }
  }
}

output "repository_id" {
  value = google_artifact_registry_repository.this.repository_id
}

output "name" {
  value = google_artifact_registry_repository.this.name
}

output "docker_path" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.this.repository_id}"
}
