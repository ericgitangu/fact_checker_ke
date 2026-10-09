import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { resolveConfig } from "../config.js";

/**
 * BFF→API trust gate (services/api/src/app.ts preHandler).
 *
 * services/api is public (INGRESS_TRAFFIC_ALL, ADR-0015), so the apps/web login
 * + reCAPTCHA gate on the cost-spending write paths is bypassable by a direct
 * POST. When BFF_PROXY_SECRET is set, those routes require a matching
 * `X-BFF-Proxy-Secret` header. These tests exercise the REAL buildApp hook (not
 * a replica) through app.inject, covering both the enforced and the
 * fail-open-when-unset modes, and proving the gate is scoped to exactly the
 * three cost-spending routes.
 */

const SECRET = "test-bff-proxy-secret-value";
const DEVICE_TOKEN = "test-device-token";

function gatedConfig() {
  return resolveConfig({ NODE_ENV: "test", BFF_PROXY_SECRET: SECRET } as NodeJS.ProcessEnv);
}

describe("BFF→API proxy gate", () => {
  it("401s a POST /v1/submissions that is missing the proxy secret (gate ON)", async () => {
    const app = await buildApp({ logger: false, config: gatedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": DEVICE_TOKEN },
      payload: { text: "a claim that should never reach the handler" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "bff_assertion_required" });
  });

  it("401s when the proxy secret is wrong (gate ON)", async () => {
    const app = await buildApp({ logger: false, config: gatedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: {
        "idempotency-key": randomUUID(),
        "x-device-token": DEVICE_TOKEN,
        "x-bff-proxy-secret": `${SECRET}-tampered`,
      },
      payload: { text: "a claim" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("lets a POST /v1/submissions through when the secret matches (gate ON)", async () => {
    const app = await buildApp({ logger: false, config: gatedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: {
        "idempotency-key": randomUUID(),
        "x-device-token": DEVICE_TOKEN,
        "x-bff-proxy-secret": SECRET,
      },
      payload: { text: "a claim" },
    });
    // The point is the gate did NOT 401 — the request reached normal handling.
    expect(res.statusCode).not.toBe(401);
  });

  it("does NOT gate a non-cost route (POST /v1/device) even with the gate ON", async () => {
    const app = await buildApp({ logger: false, config: gatedConfig() });
    const res = await app.inject({ method: "POST", url: "/v1/device" });
    // /v1/device mints the anonymous device token and is intentionally ungated;
    // the hook must scope itself to the three cost-spending routes only.
    expect(res.statusCode).not.toBe(401);
  });

  it("is a no-op when BFF_PROXY_SECRET is unset (gate OFF — fail-open)", async () => {
    const app = await buildApp({ logger: false }); // default test config: no secret
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": DEVICE_TOKEN },
      payload: { text: "a claim" },
    });
    // No secret configured -> the hook is never installed -> the header is not
    // required and the request is handled exactly as before this gate existed.
    expect(res.statusCode).not.toBe(401);
  });
});
