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
    // Integration test FILES share one live, persistent Postgres (Neon
    // `dev` or a local pgvector container) with NO per-test transaction
    // rollback. Running files in parallel (vitest's default) was
    // observed, empirically, to cross-contaminate a global-table
    // assertion in submission-outbox.integration.test.ts (an unpublished
    // outbox row written by a concurrently-running editorial-gate test
    // was counted mid-flight, before that test's own cleanup ran).
    // Serializing files removes the race; it costs wall-clock time, not
    // correctness, and matches this repo's own stated rule elsewhere
    // (scripts/at/at-0018.sh's comment: "moon cache corrupts if two moon
    // run concurrently, so run AT suites exclusively") applied one level
    // down, to test files sharing a live DB.
    fileParallelism: false,
    // 30s: the ADR-0020/0025 editorial-gate + auth-service suites chain
    // several scrypt hashes (intentionally slow, ~100ms+ each) and many
    // sequential Neon round-trips per test -- 15s was comfortably
    // enough for the pre-existing suites but times out on these under
    // real network latency (observed empirically, not assumed).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
