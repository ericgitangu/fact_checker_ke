/**
 * Workload Identity Federation for GitHub Actions. Created now per
 * ADR-0016 ("create now, unused until Actions returns" — GitHub Actions
 * is billing-locked today, 2026-10-03). No long-lived key is minted; the
 * deploy SA is only impersonable through this pool, and only from the
 * exact repo + branch below (ADR-0016 red-team amendment / AT-0016-8).
 */

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "WIF pool for fact_checker_ke GitHub Actions (ADR-0016). Unused while Actions is billing-locked."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.ref"              = "assertion.ref"
    "attribute.repository_owner" = "assertion.repository_owner"
  }

  # ADR-0016 red-team amendment (C-12): pin BOTH repository_owner and ref
  # == refs/heads/main. Without the ref pin, a workflow triggered by
  # `pull_request_target` on a fork branch could still present a token
  # with repository == the owner repo (the base repo, not the fork) while
  # running fork-controlled code — pinning ref closes that. Without the
  # owner pin, any repo under the org could mint tokens for this pool.
  attribute_condition = <<-EOT
    assertion.repository_owner == "${split("/", var.github_repository)[0]}" &&
    assertion.repository == "${var.github_repository}" &&
    assertion.ref == "refs/heads/main"
  EOT

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "fact-checker-ke-deploy"
  display_name = "fact_checker_ke deploy rail (ADR-0016)"
}

# Only the WIF-federated GitHub identity (owner repo, refs/heads/main) may
# impersonate the deploy SA. Local runs (today, while Actions is
# billing-locked) use the operator's own gcloud identity + roles granted
# below directly, NOT this binding — see envs/prod IAM for the operator
# path; this binding is dormant until Actions resumes.
resource "google_service_account_iam_member" "deploy_wif_binding" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

output "workload_identity_pool_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account_email" {
  value = google_service_account.deploy.email
}
