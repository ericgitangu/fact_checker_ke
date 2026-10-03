/**
 * Secret CONTAINER only (ADR-0016). Deliberately no
 * google_secret_manager_secret_version resource anywhere in this module —
 * secret VALUES never enter Terraform state. Values are populated
 * out-of-band with `gcloud secrets versions add <name> --data-file=-`
 * (the existing no-echo runbook, ~/.claude/reference/
 * serverless_provisioning_neon_upstash.md), which this module assumes has
 * already happened for the four pre-existing secrets named in the task
 * (fact-checker-ke-{database-url,database-url-direct,
 * upstash-redis-rest-url,upstash-redis-rest-token}).
 */

variable "project_id" {
  type = string
}

variable "secret_id" {
  type = string
}

variable "accessors" {
  description = "Service account EMAILS granted secretAccessor on exactly this secret."
  type        = list(string)
  default     = []
}

resource "google_secret_manager_secret" "this" {
  project   = var.project_id
  secret_id = var.secret_id

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each  = toset(var.accessors)
  project   = var.project_id
  secret_id = google_secret_manager_secret.this.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value}"
}

output "secret_id" {
  value = google_secret_manager_secret.this.secret_id
}

output "id" {
  value = google_secret_manager_secret.this.id
}
