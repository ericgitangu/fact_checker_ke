import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb, schema } from "@fact-checker-ke/db";
import { eq } from "drizzle-orm";
import { generateDeviceToken } from "../lib/device-token.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";
import type { ResolvedConfig } from "../config.js";

const connectionString = requireIntegrationDatabaseUrl();
const PAYSTACK_SECRET = "sk_test_integration_only";

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
    paystackSecretKey: PAYSTACK_SECRET,
  };
}

function sign(rawBody: string): string {
  return createHmac("sha512", PAYSTACK_SECRET).update(rawBody, "utf8").digest("hex");
}

/**
 * ADR-0012 §3 end-to-end against real Postgres: a verified Paystack
 * webhook writes a durable `entitlements` row (and a deduped
 * `billing_events` row), and the `GET /v1/entitlement` read path reflects
 * it. Exercises the real unique-index-upsert + FK paths, not the in-memory
 * double.
 */
describe.skipIf(!connectionString)("entitlement webhook → read (integration, Postgres)", () => {
  it("grants premium on a verified charge, is idempotent, and is readable", async () => {
    // Seed a real device token so the entitlement FK is satisfiable.
    const { db, close } = createDb(connectionString as string);
    const { token, tokenHash } = generateDeviceToken();
    const providerRef = `sub_int_${Date.now()}`;
    await db.insert(schema.deviceTokens).values({ tokenHash }).onConflictDoNothing();

    const app = await buildApp({ logger: false, config: config() });
    try {
      const body = JSON.stringify({
        event: "charge.success",
        data: {
          id: `int_${Date.now()}`,
          reference: providerRef,
          status: "success",
          next_payment_date: "2099-01-01T00:00:00.000Z",
          metadata: { subjectRef: tokenHash, tier: "premium" },
        },
      });
      const headers = { "content-type": "application/json", "x-paystack-signature": sign(body) };

      const first = await app.inject({ method: "POST", url: "/v1/billing/webhook/paystack", headers, payload: body });
      expect(first.statusCode).toBe(200);
      expect(first.json().status).toBe("granted");

      // Durable row exists and is active.
      const [row] = await db
        .select()
        .from(schema.entitlements)
        .where(eq(schema.entitlements.providerRef, providerRef));
      expect(row?.status).toBe("active");
      expect(row?.deviceTokenHash).toBe(tokenHash);

      // Read path reflects it.
      const read = await app.inject({
        method: "GET",
        url: "/v1/entitlement",
        headers: { "x-device-token": token },
      });
      expect(read.json()).toMatchObject({ premium: true, adFree: true, tier: "premium" });

      // Replay is deduped (billing_events unique on (provider,event_id)).
      const replay = await app.inject({ method: "POST", url: "/v1/billing/webhook/paystack", headers, payload: body });
      expect(replay.json().status).toBe("duplicate_ignored");

      // Cleanup (additive test hygiene — remove only this test's rows).
      await db.delete(schema.entitlements).where(eq(schema.entitlements.providerRef, providerRef));
      await db.delete(schema.deviceTokens).where(eq(schema.deviceTokens.tokenHash, tokenHash));
    } finally {
      await app.close();
      await close();
    }
  });
});
