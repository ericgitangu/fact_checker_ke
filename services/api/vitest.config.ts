import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a real Postgres (DATABASE_URL_TEST) and are
    // run separately via `pnpm test:integration` / vitest.integration.config.ts.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
