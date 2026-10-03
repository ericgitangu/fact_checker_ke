import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // packages/core and packages/i18n are consumed as workspace:* deps.
  // @fact-checker-ke/core is TS source needing transpilation; @fact-
  // checker-ke/i18n ships a built dist + plain JSON message files, which
  // Next resolves fine from node_modules without transpilation, but it is
  // still listed so a `pnpm install` without a prior `i18n:build` fails
  // loudly (missing dist) rather than silently falling back to stale JS.
  transpilePackages: ["@fact-checker-ke/core"],
};

// @serwist/turbopack (stable since 9.5, see
// https://serwist.pages.dev/docs/next/turbo) builds the service worker via a
// Next.js Route Handler (app/serwist/[path]/route.ts) that runs esbuild at
// build time, instead of hooking into webpack like @serwist/next did. That
// is what lets `next build`/`next dev` run on Turbopack (Next 16's default)
// without the `--webpack` flag. next-intl's plugin only wraps config
// (webpack-alias-free in this mode, since we don't use [locale] routing) so
// it composes with withSerwist without affecting the Turbopack build path.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(withSerwist(nextConfig));
