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

  return {
    databaseUrl,
    corsOrigins,
    upstashRedisRestUrl: env.UPSTASH_REDIS_REST_URL ?? null,
    upstashRedisRestToken: env.UPSTASH_REDIS_REST_TOKEN ?? null,
    isProduction,
  };
}
