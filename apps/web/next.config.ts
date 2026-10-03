import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // packages/core, packages/i18n and packages/brand are consumed as
  // workspace:* deps. @fact-checker-ke/core is TS source needing
  // transpilation; @fact-checker-ke/i18n ships a built dist + plain JSON
  // message files, which Next resolves fine from node_modules without
  // transpilation, but it is still listed so a `pnpm install` without a
  // prior `i18n:build` fails loudly (missing dist) rather than silently
  // falling back to stale JS. @fact-checker-ke/brand ships a built dist
  // PLUS a plain CSS file (wordmark.css) that its Wordmark component
  // imports directly -- Next's bundler only runs its CSS loader over
  // workspace packages it's told to transpile, so without this, importing
  // @fact-checker-ke/brand from app/ would fail to process that CSS import
  // (treated as an opaque, un-transpiled node_modules dependency).
  transpilePackages: ["@fact-checker-ke/core", "@fact-checker-ke/brand"],
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
