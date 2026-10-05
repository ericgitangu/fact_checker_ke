/**
 * Centralises the env-driven selection logic described in ADR-0009 /
 * the persistence-layer task brief:
 *   - DATABASE_URL set  -> Postgres repositories.
 *   - DATABASE_URL unset:
 *       - NODE_ENV=production -> fail fast at startup (no silent
 *         fallback to in-memory in prod).
 *       - otherwise (test/dev) -> in-memory repositories, with a loud
 *         warn log so nobody mistakes it for persistence.
 */
export interface ResolvedConfig {
  databaseUrl: string | null;
  corsOrigins: string[];
  upstashRedisRestUrl: string | null;
  upstashRedisRestToken: string | null;
  isProduction: boolean;
  /** ADR-0017 §1/§4: QStash publish token and the analyze-hop target URL. */
  qstashToken: string | null;
  analyzeHopUrl: string;
  /**
   * ADR-0032/0017 "C1 gap" closer: the base URL of services/pipeline
   * itself (POST {pipelineBaseUrl}/hops/analyze, /hops/verify), called
   * directly over plain HTTP by the submission-orchestrator
   * (lib/submission-orchestrator.ts) — NOT via QStash, since both calls
   * happen inside one bounded orchestration request. Same env-var
   * naming convention apps/web already uses for the reverse direction
   * (`API_BASE_URL` pointing at this service — see docs/runbooks/
   * vercel-deploy.md).
   */
  // Optional for the same reason webBaseUrl/revalidateSecret are below:
  // several existing tests construct a `ResolvedConfig` literal
  // directly, predating these three fields. `app.ts` falls back to the
  // same defaults `resolveConfig` would have used when omitted.
  pipelineBaseUrl?: string;
  /**
   * ADR-0032/0017: this service's OWN externally-reachable base URL —
   * used to build `orchestrationHopUrl` below, the target the outbox
   * relay (drainOutbox/publishOutboxRowInline) now publishes
   * `submission.received` (and every other outbox event type) to,
   * replacing the old "publish straight to the pipeline" wiring with
   * "publish to this service's own `/internal/hops/orchestrate`",
   * which then calls the pipeline hops itself and enacts the result —
   * see routes/internal.ts and lib/submission-orchestrator.ts.
   */
  apiSelfBaseUrl?: string;
  /** Derived: `${apiSelfBaseUrl}/internal/hops/orchestrate`. */
  orchestrationHopUrl?: string;
  /** ADR-0017 §4: QStash signature verification (internal endpoints). */
  qstashCurrentSigningKey: string | null;
  qstashNextSigningKey: string | null;
  /** ADR-0018/0020: HMAC secret for the SSE capability JWT. */
  capabilityTokenSecret: string;
  /** ADR-0018: Upstash Redis TCP (SUBSCRIBE/PUBLISH) endpoint, `rediss://...`. */
  redisTcpUrl: string | null;
  /**
   * ADR-0007 kill-switch mechanism (AT-0007-A): the apps/web origin and
   * shared secret for the `/api/revalidate` webhook (see
   * apps/web/app/api/revalidate/route.ts) that the kill-switch route
   * calls after a flip, to purge the ISR tag for `/maandamano` so the
   * CDN stops serving stale pages without waiting for a redeploy. Both
   * optional: when either is unset, the flip still succeeds and is
   * still audit-logged (see lib/maandamano.ts) — the flip just can't
   * also trigger CDN propagation, which is logged as a warning rather
   * than failing the request (see lib/maandamano-revalidate.ts). This
   * gap, if it ever surfaces in prod, is the exact thing
   * docs/runbooks/nc4-kill-switch.md Step 2.2 asks an operator to watch
   * for and treat as a defect.
   */
  // Optional (not just nullable): several existing tests construct a
  // `ResolvedConfig` object literal directly, predating this field, and
  // CLAUDE.md's "edit additively" rule means those call sites shouldn't
  // all need touching just to add two fields they don't exercise.
  // `app.ts` treats an omitted value the same as an explicit `null`.
  webBaseUrl?: string | null;
  revalidateSecret?: string | null;
  /**
   * ADR-0035: shared secret for the pipeline → API misinfo write-back
   * (`POST /v1/internal/maandamano/media/:mediaId/misinfo`). Optional for
   * the same reason as the two fields above (existing config literals in
   * tests predate it); fail-closed when unset — the callback route rejects
   * every request, so an embed simply stays `unchecked` rather than
   * accepting an unauthenticated status write.
   */
  pipelineCallbackSecret?: string | null;
  /**
   * ADR-0012 §3: the Paystack secret key (lead PSP — Kenya-native M-Pesa/
   * cards). Read ONLY from env, never hardcoded. Unset ⇒ the Paystack
   * adapter is `configured=false` ⇒ checkout returns 503 and every webhook
   * fails signature verification (fail-closed) — the billing surface is
   * invisible/inert until the owner adds a real key. Optional for the same
   * reason the fields above are: test config literals predate it.
   */
  paystackSecretKey?: string | null;
}

const DEFAULT_DEV_CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const isProduction = env.NODE_ENV === "production";
  const databaseUrl = env.DATABASE_URL ?? null;

  if (!databaseUrl && isProduction) {
    throw new Error(
      "DATABASE_URL is required when NODE_ENV=production. Refusing to fall back to the " +
        "in-memory repositories in production (see services/api/src/config.ts).",
    );
  }

  const corsOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_DEV_CORS_ORIGINS;

  // A capability-token secret is required in production (signs the SSE
  // capability JWT per ADR-0018/0020) -- fail fast rather than mint
  // tokens no one can verify after a restart with a fresh random
  // secret. Dev/test get a fixed placeholder so `buildApp()` doesn't
  // need every caller to supply one.
  const capabilityTokenSecret = env.CAPABILITY_TOKEN_SECRET ?? null;
  if (!capabilityTokenSecret && isProduction) {
    throw new Error(
      "CAPABILITY_TOKEN_SECRET is required when NODE_ENV=production (see services/api/src/config.ts).",
    );
  }

  const apiSelfBaseUrl = env.API_SELF_BASE_URL ?? "http://localhost:8080";

  return {
    databaseUrl,
    corsOrigins,
    upstashRedisRestUrl: env.UPSTASH_REDIS_REST_URL ?? null,
    upstashRedisRestToken: env.UPSTASH_REDIS_REST_TOKEN ?? null,
    isProduction,
    qstashToken: env.QSTASH_TOKEN ?? null,
    analyzeHopUrl: env.PIPELINE_ANALYZE_URL ?? "http://localhost:8000/internal/analyze",
    pipelineBaseUrl: env.PIPELINE_BASE_URL ?? "http://localhost:8000",
    apiSelfBaseUrl,
    orchestrationHopUrl: `${apiSelfBaseUrl}/internal/hops/orchestrate`,
    qstashCurrentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY ?? null,
    qstashNextSigningKey: env.QSTASH_NEXT_SIGNING_KEY ?? null,
    capabilityTokenSecret: capabilityTokenSecret ?? "dev-only-insecure-capability-secret",
    redisTcpUrl: env.REDIS_TCP_URL ?? null,
    webBaseUrl: env.WEB_BASE_URL ?? null,
    revalidateSecret: env.REVALIDATE_SECRET ?? null,
    pipelineCallbackSecret: env.PIPELINE_CALLBACK_SECRET ?? null,
    paystackSecretKey: env.PAYSTACK_SECRET_KEY ?? null,
  };
}
