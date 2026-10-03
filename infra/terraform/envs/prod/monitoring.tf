/**
 * ADR-0022 alerts that are EXPRESSIBLE NOW, pre-launch: the billing
 * budget (above) and a Cloud Run 5xx error-rate placeholder. Everything
 * else in ADR-0022's alert list (QStash/Neon/Upstash quota %, DLQ depth,
 * outbox lag, Neon-suspension check) depends on application-level
 * wiring (QStash subscriptions, the outbox table, a daily Neon-suspend
 * checker job) that doesn't exist yet — those are correctly deferred,
 * not implemented as fakes here. No uptime check is defined: a Cloud
 * Monitoring uptime check polling a public healthz URL would itself be
 * a periodic "always something" ping; ADR-0016's amendment already
 * requires healthz not to touch the DB, and this stack adds no
 * additional poller on top of that, so nothing here risks keeping Neon
 * awake (see ADR-0016 Neon wake budget amendment).
 */

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_notification_emails)

  project      = var.project_id
  display_name = "fact_checker_ke alerts — ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  count   = var.enable_services ? 1 : 0
  project = var.project_id

  display_name = "fact-checker-ke: Cloud Run 5xx error rate"
  combiner     = "OR"

  conditions {
    display_name = "5xx responses > threshold over 5m"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  documentation {
    content   = "5xx error rate elevated on a fact-checker-ke Cloud Run service. See docs/runbooks/ (ADR-0022) — closest match is quota-exhaustion or credential-leak depending on the error body."
    mime_type = "text/markdown"
  }
}
