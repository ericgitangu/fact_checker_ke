import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@fact-checker-ke/db";
import { isAutonomousPublishFrozen } from "../lib/publish-kill-switch.js";
import { isFetchEngineFrozen } from "../lib/fetch-kill-switch.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * Proves the exact thing db/migrations/0014_safe_launch_shadow_mode_seed.sql
 * exists to guarantee (go-live.md §0): on a DB that has NEVER had a
 * policy_flags row written -- the zero-value state every brand-new prod
 * deploy starts from -- the real migration files (not a reimplementation
 * of their SQL) must leave BOTH kill-switches FROZEN, not the code's own
 * auto-publish-on / fetch-live zero-value defaults
 * (PublishPolicyFlags.global_auto_publish_enabled=True /
 * isAutonomousPublishFrozen+isFetchEngineFrozen returning false on a
 * missing row).
 *
 * Isolation strategy: a throwaway SIBLING DATABASE (not a schema) on the
 * same Postgres server as DATABASE_URL_TEST, migrated from scratch with
 * drizzle's own migrator against db/migrations/. A schema-level sandbox
 * was tried first and rejected: 0001_baseline.sql's drizzle-kit-generated
 * `CREATE TYPE "public"."claim_type"` (and friends) hardcode the `public`
 * schema regardless of search_path, so replaying the full migration
 * history into a fresh SCHEMA on a server that has already run them once
 * (as CI's own "Run migrations against the service-container Postgres"
 * step does, and as a long-lived local/Neon dev DB will have) collides on
 * those type names. A fresh DATABASE has no such collision: types and
 * tables are database-scoped, not just schema-scoped.
 *
 * Requires CREATEDB on the connecting role. CI's Postgres service
 * container grants it (POSTGRES_USER is that container's own bootstrap
 * role). Where it isn't available -- e.g. a restricted role on a shared
 * Neon branch used for local dev -- this skips loudly (a visible
 * console.warn, not a silent pass) rather than asserting anything.
 */
const baseConnectionString = requireIntegrationDatabaseUrl();

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../db/migrations",
);

function freshDatabaseName(): string {
  return `fresh_seed_${randomUUID().replace(/-/g, "_")}`;
}

describe.skipIf(!baseConnectionString)(
  "migration 0014 safe-launch seed: a fresh-migrated DB reads both kill-switches frozen",
  () => {
    const dbName = freshDatabaseName();
    let adminClient: ReturnType<typeof postgres> | null = null;
    let freshDb: ReturnType<typeof createDb>["db"] | null = null;
    let closeFresh: (() => Promise<void>) | null = null;
    let isolationAvailable = false;

    it("provisions a throwaway sibling database and runs every real migration file against it", async () => {
      const url = new URL(baseConnectionString as string);
      adminClient = postgres(baseConnectionString as string, { max: 1 });

      try {
        // CREATE DATABASE can't run inside drizzle's query builder or a
        // transaction block -- `.unsafe` is the documented postgres-js
        // escape hatch for the rare statement with no typed equivalent.
        await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
        isolationAvailable = true;
      } catch (err) {
        isolationAvailable = false;
        // eslint-disable-next-line no-console -- a visible skip reason, not a swallowed error
        console.warn(
          `[safe-launch-seed test] skipping: the connecting role likely lacks CREATEDB ` +
            `against ${url.hostname} (or another provisioning error occurred) -- ${(err as Error).message}`,
        );
      }

      if (!isolationAvailable) return;

      url.pathname = `/${dbName}`;
      const freshConnectionString = url.toString();

      const migrateClient = postgres(freshConnectionString, { max: 1 });
      const migrateDb = drizzle(migrateClient);
      await migrate(migrateDb, { migrationsFolder: MIGRATIONS_FOLDER });
      await migrateClient.end({ timeout: 5 });

      const created = createDb(freshConnectionString);
      freshDb = created.db;
      closeFresh = created.close;
    });

    it("isAutonomousPublishFrozen reads true (frozen) on the freshly migrated DB", async () => {
      if (!isolationAvailable || !freshDb) {
        // eslint-disable-next-line no-console -- a visible skip reason, not a swallowed error
        console.warn("[safe-launch-seed test] skipped -- no isolated fresh DB available this run");
        return;
      }
      await expect(isAutonomousPublishFrozen(freshDb)).resolves.toBe(true);
    });

    it("isFetchEngineFrozen reads true (frozen) on the freshly migrated DB", async () => {
      if (!isolationAvailable || !freshDb) {
        // eslint-disable-next-line no-console -- a visible skip reason, not a swallowed error
        console.warn("[safe-launch-seed test] skipped -- no isolated fresh DB available this run");
        return;
      }
      await expect(isFetchEngineFrozen(freshDb)).resolves.toBe(true);
    });

    afterAll(async () => {
      if (closeFresh) await closeFresh();
      if (adminClient) {
        if (isolationAvailable) {
          await adminClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
        }
        await adminClient.end({ timeout: 5 });
      }
    });
  },
);
