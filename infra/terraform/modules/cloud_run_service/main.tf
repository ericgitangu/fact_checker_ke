/**
 * ADR-0016/0009 cost guardrail, enforced IN THE MODULE so no caller can
 * accidentally regress it: min_instance_count is hardcoded to 0 and
 * cpu_idle is hardcoded to true. These are NOT exposed as variables —
 * that is deliberate. A caller who needs always-on capacity must fork
 * this module, not flip a flag here; that friction is the point
 * (belt-and-suspenders alongside policy/plan-guard.sh, which would
 * reject the plan anyway, but defense in depth costs nothing).
 */

resource "google_cloud_run_v2_service" "this" {
  project  = var.project_id
  name     = var.name
  location = var.region
  ingress  = var.ingress

  template {
    service_account = var.service_account_email

    scaling {
      min_instance_count = 0 # non-overridable — see module doc comment
      max_instance_count = var.max_instance_count
    }

    timeout = "${var.timeout_seconds}s"

    containers {
      image = var.image # by digest — enforced by caller convention + release.sh

      ports {
        container_port = var.container_port
      }

      resources {
        cpu_idle          = true # non-overridable — "CPU always allocated" is a billed, always-on cost
        startup_cpu_boost = true # offsets cold-start latency from min=0 without paying for idle CPU
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      dynamic "env" {
        for_each = var.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }
    }
  }

  lifecycle {
    # Images move by digest on every release (outside Terraform, via
    # release.sh's `gcloud run deploy --no-traffic` + `update-traffic`
    # two-step for atomicity/rollback per ADR-0016). Terraform owns the
    # service's SHAPE (scaling, secrets, IAM), not which revision serves
    # traffic — ignore drift on the fields the rail mutates directly.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
