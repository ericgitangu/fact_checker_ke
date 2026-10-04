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
    # Go-live plumbing: services/api/src/config.ts reads REVALIDATE_SECRET
    # (shared with apps/web's /api/revalidate webhook -- optional at
    # runtime, see config.ts's doc comment, but wired here so it "just
    # works" the moment the owner adds a secret version).
    REVALIDATE_SECRET = {
      secret = module.secret_revalidate_secret.secret_id
    }
  }
  # Go-live plumbing (docs/runbooks/activate-on-keys-audit.md gap +
  # ADR-0015 AT-0015-2): the production CORS allow-list. Previously
  # unset anywhere in Terraform -- services/api/src/config.ts's
  # `CORS_ORIGINS` env var fell back to its localhost-only dev default
  # in every real deploy. `apps/site` was retired to a redirect-only
  # stub in the single-frontend consolidation (see README.md), so there
  # is no second origin to add here -- just the one live web origin.
  plain_env = {
    CORS_ORIGINS = "https://fact-checker-ke-web.vercel.app"
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
    # Go-live plumbing (activate-on-keys-audit.md gap #1/#2): each of
    # these activates its real client the instant a secret VERSION
    # exists (see services/pipeline/app/clients/*_factory.py) --
    # falling back to a fake/stub client when the version is absent,
    # same as today. Adding the container + this wiring does not, by
    # itself, start any real network call.
    ANTHROPIC_API_KEY = {
      secret = module.secret_anthropic_api_key.secret_id
    }
    YOUTUBE_API_KEY = {
      secret = module.secret_youtube_api_key.secret_id
    }
    GOOGLE_FACTCHECK_API_KEY = {
      secret = module.secret_google_factcheck_api_key.secret_id
    }
    REVERSE_IMAGE_API_KEY = {
      secret = module.secret_reverse_image_api_key.secret_id
    }
  }
  # Go-live safety (docs/runbooks/go-live.md §2.2, "belt-and-suspenders"):
  # app/main.py reads FETCH_ENGINE_ENABLED and defaults to "true" when
  # unset. Pin it explicitly to "false" here so the FIRST real deploy of
  # this service launches with autonomous fetch ingestion halted by
  # construction, not by relying solely on the DB-backed
  # fetch_engine_kill_switch policy flag (db/migrations/0014_*.sql) as
  # the only guard. Flipping this to "true" is the deliberate,
  # documented step 1 of go-live.md §5's later un-freeze sequence --
  # never the implicit default.
  plain_env = {
    FETCH_ENGINE_ENABLED = "false"
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
