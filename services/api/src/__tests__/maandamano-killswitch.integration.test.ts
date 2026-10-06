import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { AuthService } from "../lib/auth/service.js";
import { hotp } from "../lib/auth/totp.js";
import { MAANDAMANO_KILL_SWITCH_KEY, setMaandamanoKillSwitch } from "../lib/maandamano.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

const connectionString = requireIntegrationDatabaseUrl();

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function secretKeyFor(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function currentCodeFor(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return hotp(secretKeyFor(secret), counter);
}

/** A DIFFERENT, not-yet-consumed code than `currentCodeFor` (SEC-3: TOTP codes are single-use) -- one step ahead, still inside the module's +/-1 drift window. */
function nextStepCodeFor(secret: string): string {
  return hotp(secretKeyFor(secret), Math.floor(Date.now() / 1000 / 30) + 1);
}

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A), exercised end to end
 * through the REAL Fastify app (`buildApp`) against a real Postgres
 * instance: the public read path (`GET /v1/maandamano`), the
 * admin-only audited flip (`POST /v1/admin/maandamano/kill-switch`),
 * and the fact that a reader cannot retrieve live advisory rows while
 * the switch is on — not merely that the UI hides them.
 */
describe.skipIf(!connectionString)("ADR-0007 maandamano kill switch (AT-0007-A, integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let auth: AuthService;
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let demoId: string;

  async function createAdminWithSession(): Promise<{ id: string; token: string }> {
    const email = `ks-admin-${randomUUID()}@example.test`;
    const password = "a-reasonably-strong-password-ks";
    const registered = await auth.register(email, password);
    if (!registered.ok) throw new Error("setup: register failed");
    const enrolled = await auth.enrollTotp(registered.value.id);
    if (!enrolled.ok) throw new Error("setup: enroll failed");
    const verified = await auth.verifyTotpEnrollment(registered.value.id, currentCodeFor(enrolled.value.secret));
    if (!verified.ok) throw new Error("setup: verify failed");

    const [existingAdmin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
    const grant = existingAdmin
      ? await auth.grantRole({ id: existingAdmin.id, role: "admin" }, registered.value.id, "admin")
      : await auth.grantRole({ id: registered.value.id, role: null }, registered.value.id, "admin");
    if (!grant.ok) throw new Error(`setup: admin grant failed: ${grant.error.message}`);

    const login = await auth.login(email, password, nextStepCodeFor(enrolled.value.secret));
    if (!login.ok) throw new Error("setup: login failed");
    return { id: registered.value.id, token: login.value.token };
  }

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    auth = new AuthService(db);

    const admin = await createAdminWithSession();
    adminId = admin.id;
    adminToken = admin.token;

    // A live demonstration row the kill switch must hide from
    // `GET /v1/maandamano` while ON -- WITHOUT deleting it, so turning
    // the switch back off proves the data was withheld, not lost.
    const [demo] = await db
      .insert(schema.demonstrations)
      .values({
        title: `Kill-switch test march ${randomUUID()}`,
        area: "Test Ward",
        county: "Nairobi",
        status: "confirmed",
        summary: "A confirmed advisory used only to prove the kill switch withholds live rows.",
      })
      .returning();
    demoId = demo!.id;

    // Make sure the switch starts OFF regardless of what a previous run
    // against this (persistent, shared) database left behind.
    await setMaandamanoKillSwitch(db, { actorId: adminId, enabled: false });

    // WEB_BASE_URL/REVALIDATE_SECRET deliberately left null: this
    // exercises (and asserts on, see below) the documented "flip still
    // succeeds without CDN propagation" fallback in
    // lib/maandamano-revalidate.ts, rather than hiding that path behind
    // an untested config.
    app = await buildApp({
      config: {
        databaseUrl: connectionString as string,
        corsOrigins: ["http://localhost:3000"],
        upstashRedisRestUrl: null,
        upstashRedisRestToken: null,
        isProduction: false,
        qstashToken: null,
        analyzeHopUrl: "http://localhost:8000/internal/analyze",
        qstashCurrentSigningKey: null,
        qstashNextSigningKey: null,
        capabilityTokenSecret: "test-capability-secret",
        redisTcpUrl: null,
        webBaseUrl: null,
        revalidateSecret: null,
      },
      logger: false,
    });
  });

  afterAll(async () => {
    await setMaandamanoKillSwitch(db, { actorId: adminId, enabled: false });
    await db.delete(schema.demonstrations).where(eq(schema.demonstrations.id, demoId));
    await app.close();
    await close();
  });

  it("switch OFF: GET /v1/maandamano returns the live row", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/maandamano" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.frozen).toBe(false);
    expect(body.demonstrations.some((d: { id: string }) => d.id === demoId)).toBe(true);
  });

  it("rejects an unauthenticated flip attempt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/maandamano/kill-switch",
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin flips the switch ON: the flip is audit-logged (policy.kill_switch_flipped), and GET /v1/maandamano then withholds the live row entirely", async () => {
    const flip = await app.inject({
      method: "POST",
      url: "/v1/admin/maandamano/kill-switch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });
    expect(flip.statusCode).toBe(200);
    const flipBody = flip.json();
    expect(flipBody).toMatchObject({ key: MAANDAMANO_KILL_SWITCH_KEY, enabled: true });
    // WEB_BASE_URL/REVALIDATE_SECRET are not configured in this test
    // environment -- the flip must still succeed (see
    // lib/maandamano-revalidate.ts), just report that it couldn't also
    // trigger CDN propagation.
    expect(flipBody.revalidated).toBe(false);

    // `audit_log` is append-only and SHARED across every integration run
    // against this persistent DB (no per-test rollback) -- and the
    // maandamano-media-archive suite flips the same global key too. So
    // scope the assertion to THIS run's own actor and order explicitly by
    // createdAt: the query otherwise returns the whole accumulated set in
    // an arbitrary (no-ORDER-BY) order, and `rows[last]` lands on some
    // prior run's admin, failing `actorId === adminId` intermittently.
    // This asserts the real contract -- MY flip logged MY action -- which
    // is deterministic regardless of how many global rows exist.
    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetType, "policy_flag"),
          eq(schema.auditLog.targetId, MAANDAMANO_KILL_SWITCH_KEY),
          eq(schema.auditLog.actorId, adminId),
        ),
      )
      .orderBy(desc(schema.auditLog.createdAt));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const latest = auditRows[0]!;
    expect(latest.action).toBe("policy.kill_switch_flipped");
    expect(latest.actorId).toBe(adminId);

    // The server-side enforcement itself: the row still exists in
    // Postgres (demonstrations table untouched)...
    const [stillThere] = await db.select().from(schema.demonstrations).where(eq(schema.demonstrations.id, demoId));
    expect(stillThere).toBeDefined();

    // ...but the public API no longer returns it, or ANY row, while frozen.
    const get = await app.inject({ method: "GET", url: "/v1/maandamano" });
    expect(get.statusCode).toBe(200);
    const getBody = get.json();
    expect(getBody.frozen).toBe(true);
    expect(getBody.demonstrations).toEqual([]);
  });

  it("admin flips the switch back OFF: the live row is visible again", async () => {
    const flip = await app.inject({
      method: "POST",
      url: "/v1/admin/maandamano/kill-switch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: false },
    });
    expect(flip.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/v1/maandamano" });
    const getBody = get.json();
    expect(getBody.frozen).toBe(false);
    expect(getBody.demonstrations.some((d: { id: string }) => d.id === demoId)).toBe(true);
  });
});
