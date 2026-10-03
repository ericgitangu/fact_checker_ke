import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // @serwist/next's plugin only supports webpack, not Turbopack (Next.js
  // 16's default) — see https://github.com/serwist/serwist/issues/54. The
  // dev/build scripts in package.json pass `--webpack` explicitly so this
  // plugin has a bundler it can hook into. Also disabled outside production
  // so a stale cached service worker doesn't fight hot reload in dev.
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  // packages/core is consumed as TypeScript source (workspace:*), not a
  // prebuilt dist — this tells Next's webpack build to transpile it and to
  // resolve its NodeNext-style `./foo.js` specifiers against the `.ts` files
  // that actually exist on disk.
  transpilePackages: ["@fact-checker-ke/core"],
};

export default withSerwist(nextConfig);
