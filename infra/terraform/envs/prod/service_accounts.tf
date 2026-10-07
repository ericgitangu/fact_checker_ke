/**
 * Runtime service accounts, least-privilege: each gets secretAccessor on
 * EXACTLY the secrets its service needs (via modules/secret's
 * `accessors`), never a broad project-level secretmanager role.
 */

/**
 * account_id is capped at 30 chars by the IAM API. "fact-checker-ke-
 * pipeline-runtime" (33) and "...-migrate-runtime" (32) both exceed it
 * (verified via `terraform validate` against the real constraint) — the
 * "fcke-" prefix below is the fix, applied to all three for consistency
 * even though api-runtime alone would have fit the longer prefix.
 */

resource "google_service_account" "api_runtime" {
  project      = var.project_id
  account_id   = "fcke-api-runtime"
  display_name = "services/api runtime identity (ADR-0016)"
}

resource "google_service_account" "pipeline_runtime" {
  project      = var.project_id
  account_id   = "fcke-pipeline-runtime"
  display_name = "services/pipeline runtime identity (ADR-0016)"
}

resource "google_service_account" "migrate_runtime" {
  project      = var.project_id
  account_id   = "fcke-migrate-runtime"
  display_name = "DB migration Cloud Run Job identity (ADR-0016) — DIRECT connection only"
}

# ADR-0036: the grounded second-opinion gate reaches Gemini via Vertex AI
# (GOOGLE_GENAI_USE_VERTEXAI) authenticated by this SA's ADC — not a raw key —
# so grounding bills to the already-billed fact-checker-ke project. project-level
# aiplatform.user is the minimum for generate_content + Search grounding.
# Granted live 2026-10-07; mirrors the deploy SA's project_iam_member pattern.
resource "google_project_iam_member" "pipeline_aiplatform_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.pipeline_runtime.email}"
}

# --- Deploy SA least privilege (bootstrap created the SA; IAM bindings
# that need concrete resources live here, once those resources exist) ---

data "google_service_account" "deploy" {
  project    = var.project_id
  account_id = "fact-checker-ke-deploy"
}

resource "google_project_iam_member" "deploy_artifact_registry_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${data.google_service_account.deploy.email}"
}

# run.admin scoped to the TWO services only, via per-resource IAM
# bindings below (once enable_services=true creates them) rather than a
# project-wide roles/run.admin grant.
resource "google_cloud_run_v2_service_iam_member" "deploy_run_admin_api" {
  count    = var.enable_services ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = module.api_service[0].name
  role     = "roles/run.admin"
  member   = "serviceAccount:${data.google_service_account.deploy.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deploy_run_admin_pipeline" {
  count    = var.enable_services ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = module.pipeline_service[0].name
  role     = "roles/run.admin"
  member   = "serviceAccount:${data.google_service_account.deploy.email}"
}

# iam.serviceAccountUser on runtime SAs ONLY (needed so the deploy SA can
# deploy a revision running-as api_runtime/pipeline_runtime/migrate_runtime)
resource "google_service_account_iam_member" "deploy_act_as_api_runtime" {
  service_account_id = google_service_account.api_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${data.google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_act_as_pipeline_runtime" {
  service_account_id = google_service_account.pipeline_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${data.google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_act_as_migrate_runtime" {
  service_account_id = google_service_account.migrate_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${data.google_service_account.deploy.email}"
}
