/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * ADR-0028 / ADR-0007 AT-0007-A caching policy, explicit per route class
 * (checked against the actual `@serwist/turbopack/worker` `defaultCache`,
 * which is a single catch-all `NetworkOnly` matcher — i.e. no caching at
 * all by default — so every policy below is additive, evaluated before
 * that catch-all since Workbox/Serwist matches runtime-caching entries in
 * array order and takes the first match):
 *
 * - `/maandamano*` and its backing data: NetworkOnly — ADR-0028 is
 *   explicit that the tracker gets "no offline cache at all" (not even a
 *   stale-but-shown-as-current cache). Offline shows the app's own
 *   explicit "can't confirm current status" state (tracker.offline.*
 *   catalog keys), never a frozen cached advisory.
 * - `/checks/*` and `/api/submissions/*` (status + SSE polling fallback):
 *   NetworkFirst with a short network timeout and a short-lived cache —
 *   a cached shell may render instantly, but the network response always
 *   wins and overwrites it once it arrives (this is what "never serve a
 *   stale verdict" means in Workbox terms: NetworkFirst always attempts
 *   the network first and only falls back to cache on failure).
 * - Static chrome (`_next/static`, icons, the manifest): CacheFirst,
 *   versioned by Next's own build-hashed filenames, safe to serve offline
 *   indefinitely.
 * - Everything else: the package's own `defaultCache` (NetworkOnly)
 *   applies unchanged.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }: { url: URL }) => url.pathname.startsWith("/maandamano"),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith("/checks/") ||
        url.pathname.startsWith("/submissions/") ||
        url.pathname.startsWith("/api/submissions"),
      handler: new NetworkFirst({
        cacheName: "fck-dynamic",
        networkTimeoutSeconds: 4,
      }),
    },
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith("/_next/static") ||
        url.pathname.startsWith("/icon-") ||
        url.pathname === "/manifest.webmanifest",
      handler: new CacheFirst({ cacheName: "fck-static-chrome" }),
    },
    ...defaultCache,
  ],
  // Offline fallback: any navigation (document request) that fails while
  // offline is served the precached /~offline page instead of the browser's
  // default offline interstitial. Does NOT apply to /maandamano (NetworkOnly
  // above means a failed maandamano navigation falls through to this
  // fallback too — which is correct: "can't confirm current status" and
  // "you're offline" are both honest non-stale states).
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
