import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Runs pending db/migrations/ SQL files against DATABASE_URL_DIRECT (or
 * DATABASE_URL as a fallback for local/CI Postgres, which has no
 * pooled/direct distinction). Direct connection is required against Neon
 * because drizzle's migrator takes a session-level advisory lock that
 * pgbouncer transaction-pooling mode doesn't support.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set DATABASE_URL_DIRECT (or DATABASE_URL) before running migrations.");
  }

  // Local/CI run via `tsx src/migrate.ts` (cwd = packages/db) resolves the
  // repo-root db/migrations relatively; the containerized migrate job sets
  // MIGRATIONS_DIR to the absolute path the SQL files are COPY'd to
  // (/app/db/migrations — see services/api/Dockerfile + the migrate_job's
  // plain_env in infra/terraform/envs/prod/cloud_run.tf).
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? "../../db/migrations";

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder });
    // eslint-disable-next-line no-console -- CLI script, not a request-path log
    console.log("Migrations applied.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI script, not a request-path log
  console.error(err);
  process.exitCode = 1;
});
