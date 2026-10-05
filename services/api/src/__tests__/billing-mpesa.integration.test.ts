import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb, schema } from "@fact-checker-ke/db";
import { eq } from "drizzle-orm";
import { generateDeviceToken } from "../lib/device-token.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";
import type { MpesaConfig, ResolvedConfig } from "../config.js";

const connectionString = requireIntegrationDatabaseUrl();

function mpesaConfig(): MpesaConfig {
  return {
    consumerKey: "ck_int",
    consumerSecret: "cs_int",
    shortcode: "174379",
    passkey: "pk_int",
    env: "sandbox",
    callbackUrl: "https://api.example.test/v1/billing/webhook/mpesa",
    callbackIpAllowlist: ["127.0.0.1"],
    amountKes: 200,
  };
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
    mpesa: mpesaConfig(),
  };
}

/**
 * ADR-0012 §3 (monetization v2) end-to-end against real Postgres: a verified
 * M-Pesa STK callback, whose subject is reconciled via the
 * `pending_checkout_subjects` map (the callback echoes no subject), writes a
 * durable active `entitlements` row — exercising the real enum ('mpesa'),
 * the partial-unique-index upsert, and the FK to `device_tokens`.
 */
describe.skipIf(!connectionString)("M-Pesa callback → entitlement grant (integration, Postgres)", () => {
  it("resolves the subject from the pending map, grants premium, and dedups a replay", async () => {
    const { db, close } = createDb(connectionString as string);
    const { token, tokenHash } = generateDeviceToken();
    const checkoutRequestId = `ws_CO_int_${Date.now()}`;
    await db.insert(schema.deviceTokens).values({ tokenHash }).onConflictDoNothing();
    // Simulate the checkout route's pending write.
    await db
      .insert(schema.pendingCheckoutSubjects)
      .values({ provider: "mpesa", reference: checkoutRequestId, deviceTokenHash: tokenHash });

    const app = await buildApp({ logger: false, config: config() });
    try {
      const body = JSON.stringify({
        Body: {
          stkCallback: {
            MerchantRequestID: "mr_int",
            CheckoutRequestID: checkoutRequestId,
            ResultCode: 0,
            ResultDesc: "Success",
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: 200 },
                { Name: "MpesaReceiptNumber", Value: "QINT1" },
                { Name: "TransactionDate", Value: 20261005100000 },
                { Name: "PhoneNumber", Value: 254708123456 },
              ],
            },
          },
        },
      });
      const headers = { "content-type": "application/json" };

      const first = await app.inject({ method: "POST", url: "/v1/billing/webhook/mpesa", headers, payload: body });
      expect(first.statusCode).toBe(200);
      expect(first.json().status).toBe("granted");

      const [row] = await db
        .select()
        .from(schema.entitlements)
        .where(eq(schema.entitlements.providerRef, checkoutRequestId));
      expect(row?.status).toBe("active");
      expect(row?.provider).toBe("mpesa");
      expect(row?.deviceTokenHash).toBe(tokenHash);

      const read = await app.inject({ method: "GET", url: "/v1/entitlement", headers: { "x-device-token": token } });
      expect(read.json()).toMatchObject({ premium: true, adFree: true, tier: "premium" });

      const replay = await app.inject({ method: "POST", url: "/v1/billing/webhook/mpesa", headers, payload: body });
      expect(replay.json().status).toBe("duplicate_ignored");

      // Cleanup (additive hygiene — only this test's rows).
      await db.delete(schema.entitlements).where(eq(schema.entitlements.providerRef, checkoutRequestId));
      await db.delete(schema.pendingCheckoutSubjects).where(eq(schema.pendingCheckoutSubjects.reference, checkoutRequestId));
      await db.delete(schema.deviceTokens).where(eq(schema.deviceTokens.tokenHash, tokenHash));
    } finally {
      await app.close();
      await close();
    }
  });
});
