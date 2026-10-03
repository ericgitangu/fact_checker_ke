import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default stays "node" for the existing plain-logic suites
    // (precache-revision, claim-source-detection, etc.) — the a11y/DOM
    // test files opt into jsdom per-file via a `// @vitest-environment
    // jsdom` docblock (more robust across vitest versions than
    // `environmentMatchGlobs`, which this vitest/vite combination did not
    // apply reliably when verified empirically against a `.a11y.test.tsx`
    // file — confirmed via a real test run, not assumed).
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
