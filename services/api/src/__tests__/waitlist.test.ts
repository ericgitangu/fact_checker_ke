import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryWaitlistRepository } from "../repositories/in-memory.js";
import type { RateLimiter } from "../rate-limit.js";

function alwaysAllow(): RateLimiter {
  return { check: async () => true };
}

describe("POST /v1/waitlist", () => {
  it("returns 201 joined on first signup, then 200 already_joined on repeat (idempotent)", async () => {
    const app = await buildApp({
      logger: false,
      waitlist: new InMemoryWaitlistRepository(),
      rateLimiter: alwaysAllow(),
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/waitlist",
      payload: { email: "Jane@Example.com", source: "site" },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ status: "joined" });

    const second = await app.inject({
      method: "POST",
      url: "/v1/waitlist",
      // Same email, different casing — normalisation to lowercase is
      // asserted by the zod schema (z.string().toLowerCase()).
      payload: { email: "jane@example.com", source: "web" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "already_joined" });

    await app.close();
  });

  it("rejects an invalid email with 400", async () => {
    const app = await buildApp({
      logger: false,
      waitlist: new InMemoryWaitlistRepository(),
      rateLimiter: alwaysAllow(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/waitlist",
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it("returns 429 when the rate limiter denies the request", async () => {
    const denyLimiter: RateLimiter = { check: async () => false };
    const app = await buildApp({
      logger: false,
      waitlist: new InMemoryWaitlistRepository(),
      rateLimiter: denyLimiter,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/waitlist",
      payload: { email: "throttled@example.com" },
    });
    expect(res.statusCode).toBe(429);

    await app.close();
  });
});
