import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Creates a drizzle client over the given connection string. Callers pass
 * the pooled Neon connection string in normal request-path use, and the
 * direct (non-pooled) one only for migrations (see migrate.ts).
 *
 * `max: 1` is intentional for serverless/Cloud-Run-with-min-instances=0:
 * each instance holds at most one physical connection and relies on
 * Neon's own pooler for fan-out, rather than layering a second pool on
 * top of pgbouncer.
 */
export function createDb(connectionString: string): { db: Database; close: () => Promise<void> } {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}

export { schema };
