/**
 * Gated behind enable_services (default false) — see variables.tf.
 * `count = var.enable_services ? 1 : 0` on each module call keeps the
 * plan clean with real resources defined but not yet created.
 */

module "api_service" {
  count  = var.enable_services ? 1 : 0
  source = "../../modules/cloud_run_service"

  project_id            = var.project_id
  name                  = "fact-checker-ke-api"
  region                = var.region
  image                 = var.api_image
  service_account_email = google_service_account.api_runtime.email
  ingress               = "INGRESS_TRAFFIC_ALL" # public API (ADR-0015)
  allow_unauthenticated = true
  timeout_seconds       = 3600 # ADR-0015: SSE streams up to 60 min
  secret_env = {
    DATABASE_URL = {
      secret = module.secret_database_url.secret_id
    }
    UPSTASH_REDIS_REST_URL = {
      secret = module.secret_upstash_redis_rest_url.secret_id
    }
    UPSTASH_REDIS_REST_TOKEN = {
      secret = module.secret_upstash_redis_rest_token.secret_id
    }
  }
}

module "pipeline_service" {
  count  = var.enable_services ? 1 : 0
  source = "../../modules/cloud_run_service"

  project_id            = var.project_id
  name                  = "fact-checker-ke-pipeline"
  region                = var.region
  image                 = var.pipeline_image
  service_account_email = google_service_account.pipeline_runtime.email
  # ADR-0015 red-team amendment: QStash is an external caller, so ingress
  # must be public; the control is QStash's signature verification at
  # the application layer (AT-0015-3), not network-level privacy.
  ingress               = "INGRESS_TRAFFIC_ALL"
  allow_unauthenticated = true
  secret_env = {
    DATABASE_URL = {
      secret = module.secret_database_url.secret_id
    }
    UPSTASH_REDIS_REST_URL = {
      secret = module.secret_upstash_redis_rest_url.secret_id
    }
    UPSTASH_REDIS_REST_TOKEN = {
      secret = module.secret_upstash_redis_rest_token.secret_id
    }
  }
}

module "migrate_job" {
  count  = var.enable_services ? 1 : 0
  source = "../../modules/cloud_run_job"

  project_id            = var.project_id
  name                  = "fact-checker-ke-migrate"
  region                = var.region
  image                 = var.migrate_image
  service_account_email = google_service_account.migrate_runtime.email
  secret_env = {
    DATABASE_URL_DIRECT = {
      secret = module.secret_database_url_direct.secret_id
    }
  }
}
