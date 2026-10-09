import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const stub = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // `next-auth@beta` does a bare `import … from "next/server"` that vitest's
    // native ESM resolver can't resolve (lands on the directory, not
    // `next/server.js`), so importing it at all breaks any suite that renders
    // the app shell (AppHeader → `auth()`). Alias it (and its subpaths) to
    // tiny logged-out stubs for tests only; production uses the real package,
    // resolved by Next's bundler (verified via `next build`). Exact-match
    // regexes so `next-auth` doesn't shadow `next-auth/react` et al.
    alias: [
      {
        find: /^next-auth\/providers\/google$/,
        replacement: stub("./test/stubs/next-auth-providers-google.ts"),
      },
      { find: /^next-auth\/react$/, replacement: stub("./test/stubs/next-auth-react.ts") },
      { find: /^next-auth$/, replacement: stub("./test/stubs/next-auth.ts") },
      // `server-only` is a build-time marker with no runtime; vite's test
      // resolver can't resolve its restricted export, so map it to a no-op.
      { find: /^server-only$/, replacement: stub("./test/stubs/empty.ts") },
    ],
  },
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
