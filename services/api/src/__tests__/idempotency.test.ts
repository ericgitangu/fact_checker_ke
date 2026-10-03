import { describe, expect, it } from "vitest";
import { decideIdempotency, hashRequestBody } from "../lib/idempotency.js";

describe("hashRequestBody", () => {
  it("is independent of key order", () => {
    const a = hashRequestBody({ url: "https://example.com", submittedBy: "eric" });
    const b = hashRequestBody({ submittedBy: "eric", url: "https://example.com" });
    expect(a).toBe(b);
  });

  it("differs for a different body", () => {
    const a = hashRequestBody({ url: "https://example.com" });
    const b = hashRequestBody({ url: "https://example.org" });
    expect(a).not.toBe(b);
  });
});

describe("decideIdempotency", () => {
  it("replays the stored response when the hash matches (AT-0017 §2)", () => {
    const stored = { key: "k", requestHash: "h1", responseStatus: 202, responseBody: { id: "x" } };
    const decision = decideIdempotency(stored, "h1");
    expect(decision).toEqual({ kind: "replay", status: 202, body: { id: "x" } });
  });

  it("reports a conflict when the same key is reused with a different body", () => {
    const stored = { key: "k", requestHash: "h1", responseStatus: 202, responseBody: { id: "x" } };
    const decision = decideIdempotency(stored, "h2");
    expect(decision).toEqual({ kind: "conflict" });
  });
});
