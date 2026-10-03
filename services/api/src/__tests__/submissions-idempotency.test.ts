import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const DEVICE_TOKEN = "test-device-token";

/**
 * ADR-0017 §2 (client -> API layer), exercised through the real route
 * (not the service in isolation) against the in-memory doubles. The
 * Postgres-backed transactional-atomicity guarantee is proven
 * separately against a real database (submission-outbox.integration.test.ts)
 * per ADR-0019 ("no mocks of our own DB layer" for the thing that makes
 * atomicity real — but the idempotency CONTRACT is a fast unit test).
 */
describe("POST /v1/submissions idempotency", () => {
  it("replays the stored response for the same key + same body", async () => {
    const app = await buildApp({ logger: false });
    const key = randomUUID();
    const payload = { url: "https://example.com/clip" };
    const headers = { "idempotency-key": key, "x-device-token": DEVICE_TOKEN };

    const first = await app.inject({ method: "POST", url: "/v1/submissions", headers, payload });
    const second = await app.inject({ method: "POST", url: "/v1/submissions", headers, payload });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    await app.close();
  });

  it("returns 422 for the same key with a different body", async () => {
    const app = await buildApp({ logger: false });
    const key = randomUUID();
    const headers = { "idempotency-key": key, "x-device-token": DEVICE_TOKEN };

    const first = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers,
      payload: { url: "https://example.com/clip-a" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers,
      payload: { url: "https://example.com/clip-b" },
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(422);
    expect(second.json()).toMatchObject({ error: "idempotency_key_conflict" });
    await app.close();
  });

  it("rejects a non-UUID Idempotency-Key", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": "not-a-uuid", "x-device-token": DEVICE_TOKEN },
      payload: { text: "a claim" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /v1/submissions device quota (ADR-0020 §7)", () => {
  it("AT-0020-1: two distinct devices each get their own standing, even from the same connection", async () => {
    const app = await buildApp({ logger: false, deviceQuotaGuard: { checkAndConsume: async (token) => token !== "exhausted-device" } });
    const resA = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": "device-a" },
      payload: { text: "device A probe" },
    });
    const resExhausted = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": "exhausted-device" },
      payload: { text: "exhausted device probe" },
    });
    expect(resA.statusCode).toBe(202);
    expect(resExhausted.statusCode).toBe(429);
    await app.close();
  });
});
