/**
 * Secret CONTAINERS for the four pre-existing secrets (task scope).
 * Values already exist (populated out-of-band per the task description);
 * this only brings the containers + IAM under Terraform. Terraform never
 * writes or reads a secret VALUE (no `_version` resource, no `data`
 * source on secret payloads) — see modules/secret/main.tf.
 */

module "secret_database_url" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-database-url"
  accessors = [
    google_service_account.api_runtime.email,
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_database_url_direct" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-database-url-direct"
  accessors = [
    google_service_account.migrate_runtime.email,
  ]
}

module "secret_upstash_redis_rest_url" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-upstash-redis-rest-url"
  accessors = [
    google_service_account.api_runtime.email,
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_upstash_redis_rest_token" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-upstash-redis-rest-token"
  accessors = [
    google_service_account.api_runtime.email,
    google_service_account.pipeline_runtime.email,
  ]
}
