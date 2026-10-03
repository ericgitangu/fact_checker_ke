import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // packages/core is consumed as TypeScript source (workspace:*), not a
  // prebuilt dist — this tells Next to transpile it and to resolve its
  // NodeNext-style `./foo.js` specifiers against the `.ts` files that
  // actually exist on disk.
  transpilePackages: ["@fact-checker-ke/core"],
};

// @serwist/turbopack (stable since 9.5, see
// https://serwist.pages.dev/docs/next/turbo) builds the service worker via a
// Next.js Route Handler (app/serwist/[path]/route.ts) that runs esbuild at
// build time, instead of hooking into webpack like @serwist/next did. That
// is what lets `next build`/`next dev` run on Turbopack (Next 16's default)
// without the `--webpack` flag.
export default withSerwist(nextConfig);
