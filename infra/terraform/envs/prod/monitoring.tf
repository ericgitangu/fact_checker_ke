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

/**
 * ADR-0022 observability-as-code (this change, 2026-10-03).
 *
 * DLQ-non-empty and outbox-lag are APPLICATION-level signals (ADR-0011
 * QStash DLQ, ADR-0017 outbox sweeper) — there is no GCP/QStash/Upstash
 * API metric for either today. The pattern adopted here is the standard
 * one for exactly this gap: the app emits a structured JSON log line on
 * every sweep/check (whether the condition is true or not), and a
 * log-based metric (free: Cloud Logging's log-based metrics have a
 * generous free quota, no extra cost beyond the already-free 50 GiB/mo
 * ingestion — see ADR-0022 evidence) turns that into a metric Monitoring
 * can alert on. NEITHER of these resources polls or queries anything —
 * they are passive filters over logs the app already writes when it
 * runs its own sweep, so they add zero new traffic to Cloud Run, Neon,
 * or Upstash and cannot keep Neon awake (ADR-0016 Neon wake budget
 * amendment is unaffected).
 *
 * These signals are intentionally NOT emitted by the app yet (services/
 * pipeline's outbox sweeper and DLQ check are out of this change's
 * ownership — infra/** and scripts/release/** only). Until the app logs
 * the expected jsonPayload shape, these metrics report zero data points
 * (not zero/false — simply absent), and the alert policies stay quiet by
 * construction (no data = no threshold breach). This is the explicit,
 * documented placeholder the task asked for: AT-0022-2 and AT-0022-3
 * stay RED until the app-side emission lands; what's GREEN today is that
 * `terraform plan`/`validate` accepts these resources cleanly with
 * enable_services=false, so the signal pipeline is ready the moment the
 * app starts logging.
 *
 * Expected app log shape (contract for whoever implements the sweeper):
 *   DLQ check (services/pipeline, ADR-0011):
 *     jsonPayload.signal      = "dlq_depth_check"
 *     jsonPayload.dlq_depth   = <integer, current QStash DLQ size>
 *   Outbox sweep (services/api or services/pipeline, ADR-0017):
 *     jsonPayload.signal           = "outbox_sweep"
 *     jsonPayload.outbox_lag_secs  = <float, age in seconds of the
 *                                     oldest unpublished outbox row, or
 *                                     0 if the outbox is empty>
 * Both fields go through structured JSON logging (senior-dev default:
 * no console.log/print) so Cloud Logging indexes jsonPayload natively.
 */

resource "google_logging_metric" "dlq_non_empty" {
  project     = var.project_id
  name        = "fact_checker_ke_dlq_depth"
  description = "ADR-0022/ADR-0011: QStash DLQ depth, extracted from the app's structured dlq_depth_check log line. Zero data points until services/pipeline emits this log (app-layer, out of this change's scope)."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    jsonPayload.signal="dlq_depth_check"
    jsonPayload.dlq_depth:*
  EOT

  # GCP logs-based metrics that EXTRACT a numeric value from the log body
  # must be DISTRIBUTION/DELTA with bucket_options; a GAUGE/INT64 + a
  # value_extractor is rejected ("A value extractor can only be specified
  # for a DISTRIBUTION value type" — verified at apply 2026-10-05).
  # Exponential buckets 1..2^64 cover any DLQ depth.
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "1"
  }

  value_extractor = "EXTRACT(jsonPayload.dlq_depth)"

  bucket_options {
    exponential_buckets {
      num_finite_buckets = 64
      growth_factor      = 2
      scale              = 1
    }
  }
}

resource "google_monitoring_alert_policy" "dlq_non_empty" {
  project = var.project_id

  display_name = "fact-checker-ke: DLQ non-empty"
  combiner     = "OR"

  conditions {
    # "longer than one sweep interval" (ADR-0022) — the sweep interval
    # is >= 60 minutes per ADR-0016's Neon wake budget amendment, so the
    # alert window is set to that same 3600s floor: a single non-empty
    # reading inside one sweep cycle is expected noise, two sweeps
    # running non-empty back to back is the signal.
    display_name = "DLQ depth > 0 sustained over one sweep interval"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.dlq_non_empty.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "3600s"

      aggregations {
        alignment_period = "3600s"
        # DLQ depth is a DISTRIBUTION metric, so ALIGN_MIN (scalar-only)
        # is invalid; ALIGN_PERCENTILE_05 > 0 means ~95% of the window's
        # readings were non-empty — the "sustained, not a single spike"
        # intent, translated to a distribution reducer.
        per_series_aligner = "ALIGN_PERCENTILE_05"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  documentation {
    content   = "DLQ has held at least one message for over a full sweep interval (ADR-0011/ADR-0022, AT-0022-3). Requires services/pipeline to emit the dlq_depth_check structured log — see monitoring.tf doc comment for the exact shape. Runbook: docs/runbooks/quota-exhaustion.md (closest match; a stuck DLQ is a form of quota/throughput exhaustion)."
    mime_type = "text/markdown"
  }
}

resource "google_logging_metric" "outbox_lag" {
  project     = var.project_id
  name        = "fact_checker_ke_outbox_lag_seconds"
  description = "ADR-0022/ADR-0017: age in seconds of the oldest unpublished outbox row, extracted from the app's structured outbox_sweep log line. Zero data points until the outbox sweeper emits this log (app-layer, out of this change's scope)."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    jsonPayload.signal="outbox_sweep"
    jsonPayload.outbox_lag_secs:*
  EOT

  # Distribution/DELTA + bucket_options for the same reason as the DLQ
  # metric above (value_extractor requires DISTRIBUTION). Exponential
  # buckets 1s..2^64s span sub-second to multi-day lag.
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "s"
  }

  value_extractor = "EXTRACT(jsonPayload.outbox_lag_secs)"

  bucket_options {
    exponential_buckets {
      num_finite_buckets = 64
      growth_factor      = 2
      scale              = 1
    }
  }
}

resource "google_monitoring_alert_policy" "outbox_lag" {
  project = var.project_id

  display_name = "fact-checker-ke: outbox lag > 15 minutes"
  combiner     = "OR"

  conditions {
    display_name = "Outbox oldest unpublished row > 900s"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.outbox_lag.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 900 # 15 minutes, ADR-0022 Decision #3
      duration        = "0s"

      aggregations {
        alignment_period = "300s"
        # outbox lag is a DISTRIBUTION metric, so ALIGN_MAX (scalar-only)
        # is invalid; ALIGN_PERCENTILE_99 ≈ the worst reading in the
        # window — the faithful translation of "max lag > 900s".
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  documentation {
    content   = "Outbox relay or sweeper appears stuck — oldest unpublished row has aged past 15 minutes (ADR-0017/ADR-0022 red-team C-5/C-3, AT-0022-2). Requires the outbox sweeper to emit the outbox_sweep structured log — see monitoring.tf doc comment for the exact shape."
    mime_type = "text/markdown"
  }
}

/**
 * Dashboard for the two Cloud Run services (api, pipeline). A dashboard
 * definition is free and not gated behind enable_services: it renders
 * empty widgets until real revisions exist, which is expected and
 * harmless (no polling, no cost — Cloud Monitoring dashboards are a
 * free, static JSON definition, not a billable resource; plan-guard's
 * banned-resource list correctly does NOT include google_monitoring_
 * dashboard or google_monitoring_alert_policy — see policy/plan-guard.sh
 * comment added alongside this change).
 */
resource "google_monitoring_dashboard" "services" {
  project = var.project_id

  dashboard_json = jsonencode({
    displayName = "fact-checker-ke: api + pipeline"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "api: request count by response class"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"fact-checker-ke-api\" AND metric.type = \"run.googleapis.com/request_count\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.response_code_class"]
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "pipeline: request count by response class"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"fact-checker-ke-pipeline\" AND metric.type = \"run.googleapis.com/request_count\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.response_code_class"]
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "api: request latency p50/p95 (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"fact-checker-ke-api\" AND metric.type = \"run.googleapis.com/request_latencies\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_PERCENTILE_95"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "pipeline: request latency p50/p95 (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"fact-checker-ke-pipeline\" AND metric.type = \"run.googleapis.com/request_latencies\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_PERCENTILE_95"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 8, width = 6, height = 4
          widget = {
            title = "DLQ depth (log-based, see fact_checker_ke_dlq_depth)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.dlq_non_empty.name}\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 8, width = 6, height = 4
          widget = {
            title = "Outbox lag seconds (log-based, see fact_checker_ke_outbox_lag_seconds)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/${google_logging_metric.outbox_lag.name}\""
                    aggregation = {
                      alignmentPeriod  = "300s"
                      perSeriesAligner = "ALIGN_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        }
      ]
    }
  })
}
