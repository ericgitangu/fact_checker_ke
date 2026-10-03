import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is the migration *generator* only — it diffs src/schema.ts
 * against db/migrations/ and writes new SQL files there. The repo's
 * `db/migrations/` directory (at the monorepo root, not inside this
 * package) is the single migration history shared with any future
 * non-TS consumer (the Python pipeline service reads/writes the same
 * tables with raw SQL per ADR-0009).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "../../db/migrations",
  dbCredentials: {
    // Direct (non-pooled) connection required for migrations — pooled
    // (pgbouncer) connections don't support the session-level locks
    // drizzle-kit uses for some migration operations.
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
