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

/**
 * Go-live plumbing (docs/runbooks/activate-on-keys-audit.md gap table).
 * Containers ONLY — no `_version` resource below either, same rule as
 * above: values are added out-of-band by the owner via
 *   printf '%s' "$THE_KEY" | gcloud secrets versions add <secret-id> \
 *     --data-file=- --project=master-crossing-435409-r1
 * once this plan has been applied. Each client below already
 * activates on its own env var alone (fakes/stubs fallback when unset,
 * see services/pipeline/app/clients/*_factory.py); the only thing
 * missing before this change was the container + Cloud Run wiring.
 */

module "secret_anthropic_api_key" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-anthropic-api-key"
  accessors = [
    # services/pipeline/app/clients/llm_anthropic.py reads ANTHROPIC_API_KEY.
    # `grep -rn "ANTHROPIC_API_KEY" services/api/src` returns zero matches
    # (confirmed in activate-on-keys-audit.md) -- services/api never reads
    # this var, so it gets no accessor grant here (least privilege).
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_youtube_api_key" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-youtube-api-key"
  accessors = [
    # services/pipeline/app/clients/youtube_fetch_source.py (YOUTUBE_API_KEY_ENV).
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_google_factcheck_api_key" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-factcheck-api-key"
  accessors = [
    # services/pipeline/app/clients/factcheck_api.py (GOOGLE_FACTCHECK_API_KEY).
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_reverse_image_api_key" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-reverse-image-api-key"
  accessors = [
    # services/pipeline/app/clients/reverse_image_search.py / reverse_image_factory.py
    # (REVERSE_IMAGE_API_KEY_ENV).
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_revalidate_secret" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-revalidate-secret"
  accessors = [
    # services/api/src/config.ts reads REVALIDATE_SECRET (shared with
    # apps/web's /api/revalidate route -- see lib/maandamano-revalidate.ts).
    # Pipeline-side has no use for this.
    google_service_account.api_runtime.email,
  ]
}

module "secret_x_api_bearer_token" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-x-api-bearer-token"
  accessors = [
    # Forward-looking container ONLY. Deviation, flagged explicitly:
    # confirmed via `fetch_source_factory.py`'s own docstring and a repo
    # grep (no XFetchSource/similar file under services/pipeline/app/
    # clients/) that NO real X client exists yet -- X is a permanent
    # FakeFetchSource stub in this slice (ADR-0032 §"Per-platform
    # feasibility": X's free tier is gone, ~$0.005/read, a future wave
    # adds a real budgeted client behind its own env gate). There is
    # today no env var anywhere in the codebase this secret could
    # activate. The container is created now (owner explicitly asked for
    # it in this task) so the name exists ahead of time, but it is
    # DELIBERATELY NOT wired into `cloud_run.tf`'s secret_env map below --
    # wiring an env var that nothing reads would be dead plumbing, not
    # turnkey plumbing. Wire the Cloud Run secret_env entry in the same
    # change that ships the real X client and its activating env var.
    google_service_account.pipeline_runtime.email,
  ]
}

# --- Go-live/pilot secrets reconciled into IaC (2026-10-05) ---
# These secret CONTAINERS were created out-of-band (`gcloud secrets create`)
# during the live pilot; encoding them here makes the wiring durable and the
# plan a no-op. Values never enter state (the secret module is container-only;
# versions are added with `gcloud secrets versions add --data-file=-`).

module "secret_capability_token_secret" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-capability-token-secret"
  # services/api/src/config.ts reads CAPABILITY_TOKEN_SECRET (SSE events JWT).
  accessors = [google_service_account.api_runtime.email]
}

module "secret_qstash_token" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-qstash-token"
  # services/api: QStash publish (outbox relay / schedules).
  accessors = [google_service_account.api_runtime.email]
}

module "secret_qstash_current_signing_key" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-qstash-current-signing-key"
  # services/api/src/lib/internal-auth.ts: QStash signature verification.
  accessors = [google_service_account.api_runtime.email]
}

module "secret_qstash_next_signing_key" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-qstash-next-signing-key"
  accessors  = [google_service_account.api_runtime.email]
}

module "secret_pipeline_callback_secret" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-pipeline-callback-secret"
  # ADR-0035 misinfo write-back: pipeline POSTs the reverse-image result,
  # services/api verifies this shared secret (fail-closed when unset).
  accessors = [
    google_service_account.api_runtime.email,
    google_service_account.pipeline_runtime.email,
  ]
}

module "secret_redis_tcp_url" {
  source     = "../../modules/secret"
  project_id = var.project_id
  secret_id  = "fact-checker-ke-redis-tcp-url"
  # services/api/src/lib/pubsub.ts (ioredis) reads REDIS_TCP_URL for SSE
  # pub/sub across Cloud Run instances (rediss:// — TLS required by Upstash).
  accessors = [google_service_account.api_runtime.email]
}
