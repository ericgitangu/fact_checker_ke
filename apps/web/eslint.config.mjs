import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // @serwist/turbopack (see next.config.ts) builds the service worker
    // on-the-fly through app/serwist/[path]/route.ts — unlike the old
    // @serwist/next (webpack) setup, it no longer writes a generated
    // public/sw.js bundle to disk, so there is nothing to ignore here.
  ]),
]);

export default eslintConfig;
