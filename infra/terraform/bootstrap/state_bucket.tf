resource "google_storage_bucket" "tfstate" {
  name     = var.state_bucket_name
  project  = var.project_id
  location = var.state_bucket_region

  # Scale-to-zero cost guardrail is about COMPUTE, not storage, but this
  # bucket still gets the smallest viable footprint: standard storage
  # class (no coldline/archive — state is read on every plan/apply),
  # uniform bucket-level access (IAM only, no legacy ACLs), and
  # versioning so a bad `apply` can be rolled back from history.
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # Old state versions are metadata, not the always-on resources this
  # ADR polices — but there's no reason to keep them forever either.
  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "state_bucket_name" {
  value = google_storage_bucket.tfstate.name
}

output "state_bucket_url" {
  value = google_storage_bucket.tfstate.url
}
