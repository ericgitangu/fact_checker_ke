import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "./page";

/**
 * Open-redirect regression (Fable security sign-off, 2026-10-09): the earlier
 * `startsWith("/") && !startsWith("//")` guard let backslash/control-char
 * payloads escape same-origin because browsers normalise "\"->"/" and strip
 * tab/CR/LF. Every "escape" row below MUST collapse to "/".
 */
describe("sanitizeCallbackUrl", () => {
  it("keeps genuine same-origin paths (normalised)", () => {
    expect(sanitizeCallbackUrl("/submit")).toBe("/submit");
    expect(sanitizeCallbackUrl("/checks/abc?x=1#frag")).toBe("/checks/abc?x=1#frag");
    expect(sanitizeCallbackUrl("/a/b/c")).toBe("/a/b/c");
  });

  it("rejects every open-redirect escape -> '/'", () => {
    for (const evil of [
      "//evil.com",
      "/\\evil.com", // "/\evil.com"
      "/\\/evil.com",
      "/\tevil.com", // decoded %09
      "/\nevil.com", // decoded %0A
      "/\revil.com", // decoded %0D
      "https://evil.com",
      "http://evil.com/path",
      "javascript:alert(1)",
      "\\\\evil.com",
      "",
    ]) {
      expect(sanitizeCallbackUrl(evil)).toBe("/");
    }
  });

  it("defaults to '/' for missing / non-string / array inputs", () => {
    expect(sanitizeCallbackUrl(undefined)).toBe("/");
    expect(sanitizeCallbackUrl(["//evil.com", "/ok"])).toBe("/"); // first element wins, and it's hostile
    expect(sanitizeCallbackUrl(["/submit"])).toBe("/submit");
  });
});
