import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDb, schema } from "@fact-checker-ke/db";
import { and, eq } from "drizzle-orm";
import { generateDeviceToken } from "../lib/device-token.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";
import type { ResolvedConfig } from "../config.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";

const connectionString = requireIntegrationDatabaseUrl();
const allow: SignatureVerifier = { verify: async () => true };

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
  };
}

/**
 * ADR-0012 §3 (monetization v2) against real Postgres: the signature-verified
 * `/internal/entitlements/sweep` flips a lapsed `active` row to `expired`
 * (durable, not only lazy) and prunes a stale pending-checkout mapping, while
 * leaving a still-valid row alone.
 */
describe.skipIf(!connectionString)("entitlement expiry sweep (integration, Postgres)", () => {
  it("expires a lapsed active row, keeps a valid one, and prunes stale pending rows", async () => {
    const { db, close } = createDb(connectionString as string);
    const lapsed = generateDeviceToken();
    const valid = generateDeviceToken();
    const stamp = Date.now();
    const lapsedRef = `sweep_lapsed_${stamp}`;
    const validRef = `sweep_valid_${stamp}`;
    const stalePendingRef = `sweep_pending_${stamp}`;

    await db.insert(schema.deviceTokens).values({ tokenHash: lapsed.tokenHash }).onConflictDoNothing();
    await db.insert(schema.deviceTokens).values({ tokenHash: valid.tokenHash }).onConflictDoNothing();
    await db.insert(schema.entitlements).values({
      deviceTokenHash: lapsed.tokenHash,
      tier: "premium",
      status: "active",
      provider: "mpesa",
      providerRef: lapsedRef,
      currentPeriodEnd: new Date(stamp - 86_400_000), // 1 day ago → lapsed
    });
    await db.insert(schema.entitlements).values({
      deviceTokenHash: valid.tokenHash,
      tier: "premium",
      status: "active",
      provider: "stripe",
      providerRef: validRef,
      currentPeriodEnd: new Date(stamp + 30 * 86_400_000), // 30 days out → valid
    });
    // A stale pending row (2 days old → older than the 1-day prune cutoff).
    await db.insert(schema.pendingCheckoutSubjects).values({
      provider: "mpesa",
      reference: stalePendingRef,
      deviceTokenHash: lapsed.tokenHash,
      createdAt: new Date(stamp - 2 * 86_400_000),
    });

    const app = await buildApp({ logger: false, config: config(), signatureVerifier: allow });
    try {
      const res = await app.inject({ method: "POST", url: "/internal/entitlements/sweep", payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().expired).toBeGreaterThanOrEqual(1);
      expect(res.json().pendingPruned).toBeGreaterThanOrEqual(1);

      const [lapsedRow] = await db.select().from(schema.entitlements).where(eq(schema.entitlements.providerRef, lapsedRef));
      const [validRow] = await db.select().from(schema.entitlements).where(eq(schema.entitlements.providerRef, validRef));
      expect(lapsedRow?.status).toBe("expired");
      expect(validRow?.status).toBe("active");

      const pending = await db
        .select()
        .from(schema.pendingCheckoutSubjects)
        .where(
          and(
            eq(schema.pendingCheckoutSubjects.provider, "mpesa"),
            eq(schema.pendingCheckoutSubjects.reference, stalePendingRef),
          ),
        );
      expect(pending).toHaveLength(0);

      await db.delete(schema.entitlements).where(eq(schema.entitlements.providerRef, lapsedRef));
      await db.delete(schema.entitlements).where(eq(schema.entitlements.providerRef, validRef));
      await db.delete(schema.deviceTokens).where(eq(schema.deviceTokens.tokenHash, lapsed.tokenHash));
      await db.delete(schema.deviceTokens).where(eq(schema.deviceTokens.tokenHash, valid.tokenHash));
    } finally {
      await app.close();
      await close();
    }
  });
});
