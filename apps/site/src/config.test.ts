import { describe, it, expect } from "vitest";
import { resolveApiUrl } from "./config";
import { parseRetryAfter } from "./waitlist-outcome";

describe("resolveApiUrl", () => {
  it("accepts an absolute https URL and strips trailing slashes", () => {
    expect(resolveApiUrl("https://api.example.com/")).toEqual({ ok: true, apiUrl: "https://api.example.com" });
  });
  it.each([undefined, "", "undefined", "/v1", "ftp://x.example"])("rejects %s", (raw) => {
    expect(resolveApiUrl(raw).ok).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => expect(parseRetryAfter("30")).toBe(30));
  it("parses an HTTP-date", () => {
    const now = Date.parse("Sat, 03 Oct 2026 07:00:00 GMT");
    expect(parseRetryAfter("Sat, 03 Oct 2026 07:00:45 GMT", now)).toBe(45);
  });
  it("returns null for absent or garbage values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
