import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb, schema } from "@fact-checker-ke/db";
import { eq } from "drizzle-orm";
import { generateDeviceToken } from "../lib/device-token.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";
import type { ResolvedConfig, StripeConfig } from "../config.js";

const connectionString = requireIntegrationDatabaseUrl();
const WEBHOOK_SECRET = "whsec_integration_only";

function stripeConfig(): StripeConfig {
  return { secretKey: "sk_test_integration_only", webhookSecret: WEBHOOK_SECRET, priceId: "price_integration" };
}

function config(): ResolvedConfig {
  return {
    databaseUrl: connectionString as string,
    corsOrigins: ["http://localhost:5173"],
    upstashRedisRestUrl: null,
    upstashRedisRestToken: null,
    isProduction: false,
    qstashToken: null,
    analyzeHopUrl: "http://localhost:8000/internal/analyze",
    qstashCurrentSigningKey: null,
    qstashNextSigningKey: null,
    capabilityTokenSecret: "test-capability-secret",
    redisTcpUrl: null,
    stripe: stripeConfig(),
  };
}

/** Build the real `Stripe-Signature` header the SDK's constructEvent expects. */
function stripeSignature(payload: string, secret = WEBHOOK_SECRET): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${ts}.${payload}`, "utf8").digest("hex");
  return `t=${ts},v1=${sig}`;
}

/**
 * ADR-0012 §3 (monetization v2) against real Postgres AND the REAL Stripe SDK
 * signature verifier (no mock): a correctly-signed `checkout.session.completed`
 * grants a durable premium entitlement; a wrong signature is rejected.
 */
describe.skipIf(!connectionString)("Stripe webhook → entitlement grant (integration, Postgres + real SDK verify)", () => {
  it("rejects a mis-signed event, then grants premium on a correctly-signed completed session", async () => {
    const { db, close } = createDb(connectionString as string);
    const { token, tokenHash } = generateDeviceToken();
    const sessionId = `cs_int_${Date.now()}`;
    await db.insert(schema.deviceTokens).values({ tokenHash }).onConflictDoNothing();

    const app = await buildApp({ logger: false, config: config() });
    try {
      const created = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        id: `evt_int_${Date.now()}`,
        type: "checkout.session.completed",
        data: { object: { id: sessionId, payment_status: "paid", client_reference_id: tokenHash, created } },
      });

      // Wrong signature → 401, nothing written.
      const bad = await app.inject({
        method: "POST",
        url: "/v1/billing/webhook/stripe",
        headers: { "content-type": "application/json", "stripe-signature": stripeSignature(body, "whsec_wrong") },
        payload: body,
      });
      expect(bad.statusCode).toBe(401);

      // Correct signature → granted.
      const ok = await app.inject({
        method: "POST",
        url: "/v1/billing/webhook/stripe",
        headers: { "content-type": "application/json", "stripe-signature": stripeSignature(body) },
        payload: body,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe("granted");

      const [row] = await db.select().from(schema.entitlements).where(eq(schema.entitlements.providerRef, sessionId));
      expect(row?.status).toBe("active");
      expect(row?.provider).toBe("stripe");

      const read = await app.inject({ method: "GET", url: "/v1/entitlement", headers: { "x-device-token": token } });
      expect(read.json()).toMatchObject({ premium: true, adFree: true, tier: "premium" });

      await db.delete(schema.entitlements).where(eq(schema.entitlements.providerRef, sessionId));
      await db.delete(schema.deviceTokens).where(eq(schema.deviceTokens.tokenHash, tokenHash));
    } finally {
      await app.close();
      await close();
    }
  });
});
