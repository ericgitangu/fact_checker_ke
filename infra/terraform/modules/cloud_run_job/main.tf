/**
 * Cloud Run Job for DB migrations (ADR-0015: "pay per execution, nothing
 * idle"). Jobs have no min-instances/always-on concept at all — they run
 * to completion and stop — so there is no scale-to-zero knob to enforce
 * here the way cloud_run_service does; the guardrail that matters for a
 * job is simply that it exists as a Job, not a Service (policy/plan-guard.sh
 * doesn't need a job-specific rule because `google_cloud_run_v2_job` has
 * no scaling.min_instance_count attribute to misconfigure).
 */

resource "google_cloud_run_v2_job" "this" {
  project  = var.project_id
  name     = var.name
  location = var.region

  template {
    template {
      service_account = var.service_account_email
      max_retries     = var.max_retries
      timeout         = "${var.timeout_seconds}s"

      containers {
        image   = var.image
        command = var.command
        args    = var.args

        resources {
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
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }
}

output "name" {
  value = google_cloud_run_v2_job.this.name
}

output "id" {
  value = google_cloud_run_v2_job.this.id
}
