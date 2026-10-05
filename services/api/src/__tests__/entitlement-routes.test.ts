import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryEntitlementRepository } from "../repositories/in-memory.js";
import { hashDeviceToken } from "../lib/device-token.js";
import type { ResolvedConfig } from "../config.js";

const PAYSTACK_SECRET = "sk_test_scaffold_only";

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    databaseUrl: null,
    corsOrigins: ["http://localhost:3000"],
    upstashRedisRestUrl: null,
    upstashRedisRestToken: null,
    isProduction: false,
    qstashToken: null,
    analyzeHopUrl: "http://localhost:8000/internal/analyze",
    qstashCurrentSigningKey: null,
    qstashNextSigningKey: null,
    capabilityTokenSecret: "dev-secret",
    redisTcpUrl: null,
    paystackSecretKey: null,
    ...overrides,
  };
}

function sign(rawBody: string, secret = PAYSTACK_SECRET): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

describe("GET /v1/entitlement", () => {
  it("returns the fail-safe NO_ENTITLEMENT (ads ON) with no device token", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: baseConfig() });
    const res = await app.inject({ method: "GET", url: "/v1/entitlement" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ premium: false, adFree: false, tier: null, status: null, currentPeriodEnd: null });
    expect(res.headers["cache-control"] ?? "private, no-store").toContain("no-store");
    await app.close();
  });

  it("reflects an active entitlement granted for the device", async () => {
    const entitlements = new InMemoryEntitlementRepository();
    const deviceToken = "device-token-abc-1234567890abcdef";
    await entitlements.activateDeviceEntitlement({
      deviceTokenHash: hashDeviceToken(deviceToken),
      tier: "premium",
      provider: "paystack",
      providerRef: "sub_live",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });

    const app = await buildApp({ logger: false, entitlements, config: baseConfig() });
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlement",
      headers: { "x-device-token": deviceToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ premium: true, adFree: true, tier: "premium", status: "active" });
    await app.close();
  });
});

describe("POST /v1/billing/checkout (fail-closed stub)", () => {
  it("401s without a device token (no identity to attach premium to)", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: baseConfig() });
    const res = await app.inject({ method: "POST", url: "/v1/billing/checkout", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("503s when Paystack is unconfigured (owner has no key yet)", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: baseConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "x-device-token": "device-token-abc-1234567890abcdef" },
      payload: { tier: "premium", provider: "paystack" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("not_configured");
    await app.close();
  });

  it("501s when configured (scaffold NEVER calls a live payments API)", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: baseConfig({ paystackSecretKey: PAYSTACK_SECRET }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "x-device-token": "device-token-abc-1234567890abcdef" },
      payload: {},
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe("not_implemented");
    await app.close();
  });

  it("404s for the manual (non-checkout) provider", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: baseConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "x-device-token": "device-token-abc-1234567890abcdef" },
      payload: { provider: "manual" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/billing/webhook/:provider (fail-closed signature verify)", () => {
  const deviceToken = "device-token-abc-1234567890abcdef";
  const subjectRef = hashDeviceToken(deviceToken);

  function chargeBody(): string {
    return JSON.stringify({
      event: "charge.success",
      data: {
        id: 424242,
        reference: "ref_wh_1",
        status: "success",
        next_payment_date: "2099-01-01T00:00:00.000Z",
        metadata: { subjectRef, tier: "premium" },
      },
    });
  }

  it("401s on a missing/invalid signature", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: baseConfig({ paystackSecretKey: PAYSTACK_SECRET }),
    });
    const body = chargeBody();
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook/paystack",
      headers: { "content-type": "application/json", "x-paystack-signature": sign(body, "wrong") },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("401s when the adapter is unconfigured (fail-closed, even with a 'valid' sig)", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: baseConfig() });
    const body = chargeBody();
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook/paystack",
      headers: { "content-type": "application/json", "x-paystack-signature": sign(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("verifies, grants premium, and is idempotent on replay", async () => {
    const entitlements = new InMemoryEntitlementRepository();
    const app = await buildApp({
      logger: false,
      entitlements,
      config: baseConfig({ paystackSecretKey: PAYSTACK_SECRET }),
    });
    const body = chargeBody();
    const headers = { "content-type": "application/json", "x-paystack-signature": sign(body) };

    const first = await app.inject({ method: "POST", url: "/v1/billing/webhook/paystack", headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("granted");

    // The grant is now visible via the read path.
    const read = await app.inject({ method: "GET", url: "/v1/entitlement", headers: { "x-device-token": deviceToken } });
    expect(read.json()).toMatchObject({ premium: true, adFree: true });

    // Replay the identical (verified) event → deduped, no double-grant.
    const replay = await app.inject({ method: "POST", url: "/v1/billing/webhook/paystack", headers, payload: body });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe("duplicate_ignored");
    await app.close();
  });

  it("acknowledges (no grant) a verified but non-granting event", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: baseConfig({ paystackSecretKey: PAYSTACK_SECRET }),
    });
    const body = JSON.stringify({ event: "charge.failed", data: { id: 9, reference: "r", status: "failed" } });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook/paystack",
      headers: { "content-type": "application/json", "x-paystack-signature": sign(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("acknowledged");
    await app.close();
  });
});
