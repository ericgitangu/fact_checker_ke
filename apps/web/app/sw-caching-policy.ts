/**
 * ADR-0028 / ADR-0007 AT-0007-A service-worker caching policy — route
 * predicates and cache names, extracted out of app/sw.ts so the exact
 * same matcher functions that decide routing in the real service worker
 * can be imported directly by tests (apps/web/app/sw-offline.test.ts),
 * instead of a test maintaining its own copy of "what counts as a
 * maandamano route" that could silently drift from the real one.
 *
 * This file has NO `self`/`ServiceWorkerGlobalScope` dependency, so it is
 * importable from a plain Node/vitest process.
 */

export const DYNAMIC_CACHE_NAME = "fck-dynamic";
export const STATIC_CHROME_CACHE_NAME = "fck-static-chrome";
export const OFFLINE_FALLBACK_URL = "/~offline";

/** ADR-0028: "no offline cache at all" for the Maandamano tracker. */
export function isMaandamanoRoute({ url }: { url: URL }): boolean {
  return url.pathname.startsWith("/maandamano");
}

/**
 * ADR-0028: published check pages + submission status/SSE-polling
 * fallback routes. NetworkFirst with a short timeout — "a cached shell
 * may render instantly, but the network response always wins".
 */
export function isDynamicRoute({ url }: { url: URL }): boolean {
  return (
    url.pathname.startsWith("/checks/") ||
    url.pathname.startsWith("/submissions/") ||
    url.pathname.startsWith("/api/submissions")
  );
}

/** Static, build-hashed chrome — safe to serve offline indefinitely. */
export function isStaticChromeRoute({ url }: { url: URL }): boolean {
  return (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.webmanifest"
  );
}

/** The offline-fallback plugin's own matcher: only document (navigation) requests. */
export function isDocumentRequest({ request }: { request: Request }): boolean {
  return request.destination === "document";
}
