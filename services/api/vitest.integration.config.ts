import { defineConfig } from "vitest/config";

/**
 * Integration tests exercise the real Postgres repositories against
 * DATABASE_URL_TEST (local docker compose pgvector, the Neon `dev`
 * branch, or the pgvector service container in CI). They run as a
 * separate pnpm script, not part of the default `test` task, because
 * they require a live database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
