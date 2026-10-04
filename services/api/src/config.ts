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

  return {
    databaseUrl,
    corsOrigins,
    upstashRedisRestUrl: env.UPSTASH_REDIS_REST_URL ?? null,
    upstashRedisRestToken: env.UPSTASH_REDIS_REST_TOKEN ?? null,
    isProduction,
    qstashToken: env.QSTASH_TOKEN ?? null,
    analyzeHopUrl: env.PIPELINE_ANALYZE_URL ?? "http://localhost:8000/internal/analyze",
    qstashCurrentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY ?? null,
    qstashNextSigningKey: env.QSTASH_NEXT_SIGNING_KEY ?? null,
    capabilityTokenSecret: capabilityTokenSecret ?? "dev-only-insecure-capability-secret",
    redisTcpUrl: env.REDIS_TCP_URL ?? null,
    webBaseUrl: env.WEB_BASE_URL ?? null,
    revalidateSecret: env.REVALIDATE_SECRET ?? null,
  };
}
