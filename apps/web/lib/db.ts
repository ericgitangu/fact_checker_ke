import "server-only";
import { createDb, schema, type Database } from "@fact-checker-ke/db";

/**
 * Minimal server-only Drizzle client for apps/web.
 *
 * apps/web is otherwise a pure BFF — every other data path forwards to
 * services/api over HTTP (see app/api/.../route.ts) and the web layer holds
 * NO direct DB access. The ONE exception is the public-auth "early adopters"
 * roster (lib/early-adopters.ts), upserted from the Auth.js sign-in callback:
 * routing that single write through services/api would mean standing up a new
 * authenticated API surface for a fire-and-forget roster write, so instead we
 * reuse packages/db's own client (the same `createDb` the API and pipeline
 * use) against the pooled `DATABASE_URL`.
 *
 * `server-only` makes an accidental client import a BUILD error, not a runtime
 * leak — the Neon connection string must never reach the browser bundle.
 *
 * Singleton on `globalThis` so a warm serverless instance / HMR reuses one
 * physical connection (createDb pins `max: 1`, delegating fan-out to Neon's
 * pooler — see packages/db/src/client.ts), rather than opening a socket per
 * sign-in.
 */
type DbHandle = { db: Database; close: () => Promise<void> };

const globalForDb = globalThis as unknown as { __fckWebDb?: DbHandle };

/**
 * Returns the shared Drizzle client. Throws when `DATABASE_URL` is unset — the
 * caller (early-adopters upsert) treats that as fail-open, so a web deployment
 * without the var still lets people sign in; it just doesn't record the roster
 * row. Nothing in the auth path reads this DB back, so that degradation is
 * invisible to the session.
 */
export function getDb(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set — apps/web cannot reach Postgres");
  }
  if (globalForDb.__fckWebDb === undefined) {
    globalForDb.__fckWebDb = createDb(connectionString);
  }
  return globalForDb.__fckWebDb.db;
}

export { schema };
