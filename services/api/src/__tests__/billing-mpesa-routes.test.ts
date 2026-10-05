import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryEntitlementRepository } from "../repositories/in-memory.js";
import { hashDeviceToken } from "../lib/device-token.js";
import type { MpesaConfig, ResolvedConfig, StripeConfig } from "../config.js";

const MPESA_CONFIGURED: MpesaConfig = {
  consumerKey: "ck",
  consumerSecret: "cs",
  shortcode: "174379",
  passkey: "pk",
  env: "sandbox",
  callbackUrl: "https://api.example.test/v1/billing/webhook/mpesa",
  // Fastify inject() presents the request from 127.0.0.1.
  callbackIpAllowlist: ["127.0.0.1"],
  amountKes: 200,
};

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
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

const deviceToken = "device-token-mpesa-1234567890abcdef";
const subjectRef = hashDeviceToken(deviceToken);

function callbackBody(checkoutRequestId: string, resultCode = 0): string {
  return JSON.stringify({
    Body: {
      stkCallback: {
        MerchantRequestID: "mr_1",
        CheckoutRequestID: checkoutRequestId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? "Success" : "Cancelled",
        ...(resultCode === 0
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: "Amount", Value: 200 },
                  { Name: "MpesaReceiptNumber", Value: "QX1" },
                  { Name: "TransactionDate", Value: 20261005100000 },
                  { Name: "PhoneNumber", Value: 254708123456 },
                ],
              },
            }
          : {}),
      },
    },
  });
}

describe("POST /v1/billing/checkout — provider selection (ADR-0012 v2)", () => {
  it("503s for M-Pesa when its block is present but unconfigured (no live network call)", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: config({ mpesa: { ...MPESA_CONFIGURED, consumerKey: null, passkey: null } }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "x-device-token": deviceToken },
      payload: { provider: "mpesa", phone: "0708123456" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("not_configured");
    await app.close();
  });

  it("503s for Stripe when unconfigured", async () => {
    const stripe: StripeConfig = { secretKey: null, webhookSecret: null, priceId: null };
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: config({ stripe }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "x-device-token": deviceToken },
      payload: { provider: "stripe" },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("404s for M-Pesa when the provider isn't registered at all", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: config() });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { "x-device-token": deviceToken },
      payload: { provider: "mpesa" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/billing/webhook/mpesa — Daraja callback (grant via pending subject)", () => {
  it("verifies (IP + fields), resolves the subject from the pending map, grants, and dedups", async () => {
    const entitlements = new InMemoryEntitlementRepository();
    // The route records this at checkout time; the M-Pesa callback echoes no
    // subject, so this map is the ONLY way to know whose premium to grant.
    await entitlements.putPendingSubject({ provider: "mpesa", reference: "ws_CO_grant", deviceTokenHash: subjectRef });

    const app = await buildApp({ logger: false, entitlements, config: config({ mpesa: MPESA_CONFIGURED }) });
    const body = callbackBody("ws_CO_grant");
    const headers = { "content-type": "application/json" };

    const first = await app.inject({ method: "POST", url: "/v1/billing/webhook/mpesa", headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("granted");

    const read = await app.inject({ method: "GET", url: "/v1/entitlement", headers: { "x-device-token": deviceToken } });
    expect(read.json()).toMatchObject({ premium: true, adFree: true, tier: "premium", status: "active" });

    const replay = await app.inject({ method: "POST", url: "/v1/billing/webhook/mpesa", headers, payload: body });
    expect(replay.json().status).toBe("duplicate_ignored");
    await app.close();
  });

  it("acknowledges without granting when the user cancels (ResultCode != 0)", async () => {
    const entitlements = new InMemoryEntitlementRepository();
    await entitlements.putPendingSubject({ provider: "mpesa", reference: "ws_CO_cancel", deviceTokenHash: subjectRef });
    const app = await buildApp({ logger: false, entitlements, config: config({ mpesa: MPESA_CONFIGURED }) });

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook/mpesa",
      headers: { "content-type": "application/json" },
      payload: callbackBody("ws_CO_cancel", 1032),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("acknowledged");
    await app.close();
  });

  it("acknowledges (no grant) a success with no recorded pending subject — never guesses", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: config({ mpesa: MPESA_CONFIGURED }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook/mpesa",
      headers: { "content-type": "application/json" },
      payload: callbackBody("ws_CO_unknown"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("acknowledged");
    await app.close();
  });

  it("400s a verified-but-unparseable body, and the whole surface is inert when unconfigured (401)", async () => {
    // Unconfigured M-Pesa (no allowlist/creds) → verifyWebhook fails closed → 401.
    const inert = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: config({ mpesa: { ...MPESA_CONFIGURED, callbackIpAllowlist: [], consumerKey: null } }),
    });
    const inertRes = await inert.inject({
      method: "POST",
      url: "/v1/billing/webhook/mpesa",
      headers: { "content-type": "application/json" },
      payload: callbackBody("ws_CO_x"),
    });
    expect(inertRes.statusCode).toBe(401);
    await inert.close();
  });
});
