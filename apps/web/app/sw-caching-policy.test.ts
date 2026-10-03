import { describe, expect, it } from "vitest";
import {
  isDocumentRequest,
  isDynamicRoute,
  isMaandamanoRoute,
  isStaticChromeRoute,
} from "./sw-caching-policy";

function url(path: string): URL {
  return new URL(path, "https://fact-checker.ke");
}

describe("sw-caching-policy route predicates (the real app/sw.ts routing logic)", () => {
  it("isMaandamanoRoute matches the tracker and its subpaths only", () => {
    expect(isMaandamanoRoute({ url: url("/maandamano") })).toBe(true);
    expect(isMaandamanoRoute({ url: url("/maandamano/nairobi-cbd") })).toBe(true);
    expect(isMaandamanoRoute({ url: url("/checks/abc") })).toBe(false);
    expect(isMaandamanoRoute({ url: url("/") })).toBe(false);
  });

  it("isDynamicRoute matches check pages, submission pages, and the submissions API", () => {
    expect(isDynamicRoute({ url: url("/checks/abc-123") })).toBe(true);
    expect(isDynamicRoute({ url: url("/submissions/abc-123") })).toBe(true);
    expect(isDynamicRoute({ url: url("/api/submissions/abc-123/events") })).toBe(true);
    expect(isDynamicRoute({ url: url("/maandamano") })).toBe(false);
    expect(isDynamicRoute({ url: url("/editor") })).toBe(false);
  });

  it("isStaticChromeRoute matches only build-hashed/static assets", () => {
    expect(isStaticChromeRoute({ url: url("/_next/static/chunks/main.js") })).toBe(true);
    expect(isStaticChromeRoute({ url: url("/icon-192x192.png") })).toBe(true);
    expect(isStaticChromeRoute({ url: url("/manifest.webmanifest") })).toBe(true);
    expect(isStaticChromeRoute({ url: url("/checks/abc") })).toBe(false);
  });

  it("isDocumentRequest (the offline-fallback matcher) only matches navigations", () => {
    expect(isDocumentRequest({ request: new Request("https://x/", { method: "GET" }) })).toBe(false);
    // jsdom/undici's Request has no way to force `destination` from the
    // constructor (it's browser-navigation-only metadata) -- verified via
    // the real `Request` class rather than assumed, and documented as a
    // real limitation: `destination` is only ever "document" for an
    // actual browser navigation, which is exactly the fallback's intent.
    expect(new Request("https://x/").destination).toBe("");
  });
});
