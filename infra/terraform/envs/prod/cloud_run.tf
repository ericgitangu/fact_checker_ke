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
    # Reconciled from the live pilot (2026-10-05): SSE JWT, QStash publish +
    # signature verification, the ADR-0035 misinfo callback secret, and the
    # Redis TCP URL for SSE pub/sub.
    CAPABILITY_TOKEN_SECRET = {
      secret = module.secret_capability_token_secret.secret_id
    }
    QSTASH_TOKEN = {
      secret = module.secret_qstash_token.secret_id
    }
    QSTASH_CURRENT_SIGNING_KEY = {
      secret = module.secret_qstash_current_signing_key.secret_id
    }
    QSTASH_NEXT_SIGNING_KEY = {
      secret = module.secret_qstash_next_signing_key.secret_id
    }
    PIPELINE_CALLBACK_SECRET = {
      secret = module.secret_pipeline_callback_secret.secret_id
    }
    REDIS_TCP_URL = {
      secret = module.secret_redis_tcp_url.secret_id
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
    # Reconciled from the live pilot (2026-10-05). PIPELINE_BASE_URL: the
    # orchestrator calls the pipeline's hops directly (ADR-0032 C1). Hardcoded
    # (not module.pipeline_service[0].url) to avoid an api<->pipeline reference
    # cycle, since the pipeline also needs API_BASE_URL. API_SELF_BASE_URL: the
    # orchestrate callback target (QStash can't reach localhost). HOST=:: binds
    # IPv6 for Cloud Run.
    PIPELINE_BASE_URL = "https://fact-checker-ke-pipeline-zytlwdcoxa-bq.a.run.app"
    API_SELF_BASE_URL = "https://fact-checker-ke-api-zytlwdcoxa-bq.a.run.app"
    HOST              = "::"
    # ADR-0038 HYBRID crowdsource thresholds (explicit for operability — tune
    # without a code deploy as KE source availability dictates). TRIGGER=1: a
    # single accepted authoritative community source re-verifies a thread and can
    # lift it to a caveated `preliminary` (thin-source KE reality). PUBLISH=2: a
    # HARD auto-published verdict still needs >= 2 independent accepted sources —
    # one community source never flips a public verdict on its own. These match
    # the services/api/src/config.ts defaults; set here so they are visible.
    CROWDSOURCE_REVERIFY_THRESHOLD         = "1"
    CROWDSOURCE_REVERIFY_PUBLISH_THRESHOLD = "2"
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
    # ADR-0035: the misinfo write-back POSTs to services/api with this shared
    # secret (reconciled from the live pilot, 2026-10-05).
    PIPELINE_CALLBACK_SECRET = {
      secret = module.secret_pipeline_callback_secret.secret_id
    }
    # ADR-0036: the grounded second-opinion gate's Gemini key. Absent -> the
    # corroboration client is the Fake (activate-on-keys) and the verify hop
    # fails closed to no_second_opinion. Reconciled from the live pilot
    # (2026-10-07, rev 00018-7vq).
    GEMINI_API_KEY = {
      secret = module.secret_gemini_api_key.secret_id
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
    # Reconciled from the live pilot (2026-10-05): the autonomous fetch engine
    # was deliberately un-frozen (go-live.md §5 step 1) — this encodes that
    # armed state so a future apply keeps it on rather than re-freezing. The
    # DB-backed fetch_engine_kill_switch (migration 0014) remains the runtime
    # guard. publishedAfter window pinned to 2 days ("current virals only").
    FETCH_ENGINE_ENABLED         = "true"
    YOUTUBE_PUBLISHED_AFTER_DAYS = "3"
    YOUTUBE_FETCH_QUERY          = "Kenya Ruto maandamano"
    # Virals-stale fix (2026-10-08): the "search" keyword mode went quiet + is
    # quota-heavy (100 units/call); "trending" pulls YouTube's own mostPopular KE
    # chart (1 unit, virality-native) — the right source for a "Most viral" feed.
    YOUTUBE_DISCOVERY_MODE = "trending"
    # ADR-0037 velocity: with reobserve OFF a seen (platform,native_id) was
    # dropped forever without re-scoring, so the feed could never accrue velocity
    # and froze once the trending set was seen. ON = trend/velocity accumulates.
    FETCH_VELOCITY_REOBSERVE = "true"
    API_BASE_URL             = "https://fact-checker-ke-api-zytlwdcoxa-bq.a.run.app"
    # ADR-0036 corroboration gate (reconciled 2026-10-07, rev w/ Vertex grounding):
    # SHADOW on (zero confidence lift until a per-stratum artifact is fitted).
    # GROUNDING ON via Vertex AI — authed by the pipeline SA's ADC
    # (aiplatform.user), billed to this already-billed project, NO raw key. The
    # dedicated daily spend lane stays tiny (~$0.30/day ≈ 7 grounded calls at the
    # grounding-aware $0.04 estimate) to hold near-0 until monetization. Flip
    # GEMINI_CORROBORATION_GROUNDED=false to fall back to free ungrounded.
    CORROBORATION_SHADOW_MODE             = "true"
    GOOGLE_GENAI_USE_VERTEXAI             = "true"
    GOOGLE_CLOUD_PROJECT                  = var.project_id
    GOOGLE_CLOUD_LOCATION                 = "global"
    GEMINI_CORROBORATION_GROUNDED         = "true"
    CORROBORATION_ENGINE_DAILY_BUDGET_USD = "0.30"
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

  # migrate_image is the same artifact as api_image (pass $API_DIGEST for
  # both). The api image's default CMD starts the Fastify server; this job
  # overrides it to run the Drizzle migrator entrypoint instead (compiled
  # from packages/db/src/migrate.ts into the db package's dist, present in
  # the image's node_modules). MIGRATIONS_DIR points at the SQL files the
  # Dockerfile COPY'd to /app/db/migrations.
  command = ["node"]
  args    = ["node_modules/@fact-checker-ke/db/dist/migrate.js"]
  plain_env = {
    MIGRATIONS_DIR = "/app/db/migrations"
  }

  secret_env = {
    DATABASE_URL_DIRECT = {
      secret = module.secret_database_url_direct.secret_id
    }
  }
}
