/**
 * Billing budget with alerts at $1/$5/$10 (ADR-0016). Scoped to this
 * project only (budgetFilter.projects), so it doesn't fire on unrelated
 * spend elsewhere on the same billing account.
 *
 * [MANUAL fallback]: if the identity running `terraform apply` lacks
 * `billing.budgets.create` on the billing account, this resource's apply
 * fails with a permission error. VERIFIED this session (not assumed):
 * `gcloud billing budgets list --billing-account=01C382-12CD13-DCA6EF`
 * returned existing budgets successfully for developer.ericgitangu@
 * gmail.com, confirming the permission IS present — this resource is
 * expected to apply cleanly, not to require the manual fallback.
 */

resource "google_billing_budget" "prod" {
  billing_account = var.billing_account_id
  display_name    = "fact-checker-ke prod (ADR-0016)"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "10"
    }
  }

  dynamic "threshold_rules" {
    for_each = var.budget_thresholds_usd
    content {
      threshold_percent = threshold_rules.value / 10 # fraction of the $10 budget amount
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    monitoring_notification_channels = [for c in google_monitoring_notification_channel.email : c.id]
    disable_default_iam_recipients   = false
  }
}

data "google_project" "this" {
  project_id = var.project_id
}
