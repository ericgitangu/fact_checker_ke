// serwist's dev-mode logging touches `location`/`self` the way a real
// browser/SW thread provides them (see the ReferenceError this caught
// when run under plain "node" -- empirically, not assumed); jsdom
// supplies both for free, same as a real worker's global scope would.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkFirst, NetworkOnly } from "serwist";
import { DYNAMIC_CACHE_NAME, isMaandamanoRoute, isDynamicRoute } from "./sw-caching-policy";

/**
 * AT-0028-4 / AT-0028-5: these exercise the REAL `serwist` strategy
 * classes (the same `NetworkFirst`/`NetworkOnly` app/sw.ts constructs,
 * with the exact same cache name/timeout options) and the REAL route
 * predicates from ./sw-caching-policy (the same functions app/sw.ts
 * wires into its `runtimeCaching` array) -- not a reimplementation of
 * Workbox/Serwist's caching behaviour.
 *
 * The one thing genuinely unavailable outside a real browser service-
 * worker thread is the Cache Storage API itself (`caches`/`CacheStorage`)
 * -- jsdom does not implement it, and there is no vitest environment that
 * does. `fakeCacheStorage()` below is a minimal, faithful polyfill of
 * JUST that browser API surface (`caches.open()`/`.put()`/`.match()`,
 * `caches.match()`), backed by an in-memory Map. It makes no caching
 * DECISIONS of its own -- every decision (network-first vs network-only,
 * when to fall back, when to overwrite) comes from the real Strategy
 * class calling into this polyfill, exactly as it would call into a
 * browser's real CacheStorage.
 */
function fakeCacheStorage() {
  const named = new Map<string, Map<string, Response>>();
  function bucket(name: string): Map<string, Response> {
    if (!named.has(name)) named.set(name, new Map());
    return named.get(name)!;
  }
  function keyFor(input: RequestInfo | URL): string {
    return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  }
  return {
    open: async (name: string) => {
      const b = bucket(name);
      return {
        match: async (input: RequestInfo | URL) => b.get(keyFor(input)),
        put: async (input: RequestInfo | URL, response: Response) => {
          b.set(keyFor(input), response.clone());
        },
        delete: async (input: RequestInfo | URL) => b.delete(keyFor(input)),
      };
    },
    // CacheStorage.match (used by StrategyHandler.cacheMatch) searches a
    // single named cache when `{ cacheName }` is given -- which is always
    // true for app/sw.ts's named caches, so that's all this polyfills.
    match: async (input: RequestInfo | URL, options?: { cacheName?: string }) => {
      if (options?.cacheName) return bucket(options.cacheName).get(keyFor(input));
      for (const b of named.values()) {
        const hit = b.get(keyFor(input));
        if (hit) return hit;
      }
      return undefined;
    },
    _debugBucket: bucket,
  };
}

/**
 * Minimal stand-in for a `FetchEvent`. Serwist's dev-mode assertions
 * (`finalAssertExports.isInstance`) require `options.event instanceof
 * ExtendableEvent` -- real, intentional validation on Serwist's part, not
 * something to work around with `as never`. `Object.create(Base.prototype)`
 * produces a real instance of the (stubbed) `ExtendableEvent` global
 * without needing to replicate the browser's real Event constructor
 * machinery, then adds the one method (`waitUntil`) Strategy.handle()
 * actually calls.
 */
// Not the DOM lib's `ExtendableEvent` type (this file compiles under the
// main app tsconfig, which doesn't include the "webworker" lib that type
// comes from -- only apps/web/app/sw.ts itself does, via
// tsconfig.worker.json) -- just the one method Strategy.handle() calls.
interface FakeExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

function fakeEvent(): FakeExtendableEvent {
  const Base = (globalThis as unknown as { ExtendableEvent: { new (): object } }).ExtendableEvent;
  const event = Object.create(Base.prototype) as FakeExtendableEvent;
  event.waitUntil = (p: Promise<unknown>) => void p.catch(() => {});
  return event;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as unknown as { self: typeof globalThis }).self = globalThis;
  globalThis.caches = fakeCacheStorage() as unknown as CacheStorage;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Strategy.handleAll() does `options instanceof FetchEvent` to decide
  // whether it was handed a real FetchEvent or a plain options object --
  // we always pass a plain object, but `FetchEvent` (a browser/SW-only
  // global) still has to exist as *something* for `instanceof` not to
  // throw a ReferenceError outside a real service-worker thread.
  if (!("FetchEvent" in globalThis)) {
    vi.stubGlobal("FetchEvent", class FetchEvent {});
  }
  if (!("ExtendableEvent" in globalThis)) {
    vi.stubGlobal("ExtendableEvent", class ExtendableEvent {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AT-0028-4: /checks/* NetworkFirst never serves a stale verdict once the network answers", () => {
  it("overwrites a stale cached rating with the fresh network response", async () => {
    const url = "https://fact-checker.ke/checks/abc-123";
    expect(isDynamicRoute({ url: new URL(url) })).toBe(true);

    const cache = await globalThis.caches.open(DYNAMIC_CACHE_NAME);
    await cache.put(url, new Response(JSON.stringify({ rating: "False" }), { status: 200 }));

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ rating: "True" }), { status: 200 }));

    const strategy = new NetworkFirst({ cacheName: DYNAMIC_CACHE_NAME, networkTimeoutSeconds: 4 });
    const response = await strategy.handle({ event: fakeEvent(), request: new Request(url) });

    const body = (await response!.json()) as { rating: string };
    expect(body.rating).toBe("True");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // fetchAndCachePut also overwrites the cache entry in the background
    // -- the NEXT read (e.g. a second tab) must not see the stale "False"
    // either.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const recached = await cache.match(url);
    const recachedBody = (await recached!.json()) as { rating: string };
    expect(recachedBody.rating).toBe("True");
  });

  it("falls back to the cached response only when the network genuinely fails (documented, non-ADR-violating behaviour)", async () => {
    const url = "https://fact-checker.ke/checks/def-456";
    const cache = await globalThis.caches.open(DYNAMIC_CACHE_NAME);
    await cache.put(url, new Response(JSON.stringify({ rating: "Misleading" }), { status: 200 }));
    fetchMock.mockRejectedValue(new Error("offline"));

    const strategy = new NetworkFirst({ cacheName: DYNAMIC_CACHE_NAME, networkTimeoutSeconds: 4 });
    const response = await strategy.handle({ event: fakeEvent(), request: new Request(url) });
    const body = (await response!.json()) as { rating: string };
    expect(body.rating).toBe("Misleading");
  });
});

describe("AT-0028-5: /maandamano NetworkOnly never serves a cached advisory, even if one exists", () => {
  it("rejects rather than falling back to a pre-existing cache entry when the network fails", async () => {
    const url = "https://fact-checker.ke/maandamano";
    expect(isMaandamanoRoute({ url: new URL(url) })).toBe(true);

    // Simulate "a previously cached tracker response in the SW cache" --
    // even a cache NetworkOnly never writes to itself would, in
    // principle, still not be consulted; using the same dynamic cache
    // name makes this the strongest version of the test.
    const cache = await globalThis.caches.open(DYNAMIC_CACHE_NAME);
    await cache.put(url, new Response(JSON.stringify({ status: "confirmed" }), { status: 200 }));

    fetchMock.mockRejectedValue(new Error("offline"));

    const strategy = new NetworkOnly();
    await expect(
      strategy.handle({ event: fakeEvent(), request: new Request(url) }),
    ).rejects.toThrow();

    // The cached advisory from before the kill switch/offline event must
    // never be the thing a caller falls back to -- NetworkOnly simply has
    // no cache-read path at all, which `_handle`'s rejection demonstrates;
    // apps/web/app/sw.ts's `fallbacks` config (see sw-caching-policy.ts's
    // `isDocumentRequest` + app/~offline/page.tsx, covered by
    // apps/web/app/~offline/page.a11y.test.tsx) is what the real SW shows
    // instead of this rejection, for a navigation request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
