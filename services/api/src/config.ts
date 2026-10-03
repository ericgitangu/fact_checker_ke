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
  };
}
