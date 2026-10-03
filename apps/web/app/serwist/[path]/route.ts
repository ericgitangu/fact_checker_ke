import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Used as a cache-busting revision for the extra (non-build-hashed) files we
// precache, e.g. the offline fallback page. Falls back to a random UUID
// (forces a precache update every build) if `git` isn't available, such as
// in some container builds.
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
  });
