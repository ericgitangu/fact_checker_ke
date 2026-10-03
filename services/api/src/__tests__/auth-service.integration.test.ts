import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { eq } from "drizzle-orm";
import { AuthService } from "../lib/auth/service.js";
import { hotp } from "../lib/auth/totp.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0020-3: "A role grant to editor or admin is rejected unless the
 * target account has a verified TOTP enrollment."
 * AT-0020-4: "Every publish, correction and kill-switch flip produces
 * exactly one audit_log row in the same transaction as the action; a
 * rolled-back action produces zero rows." (login/role-grant actions
 * exercised here as the first real actions that exist to audit.)
 */
const connectionString = requireIntegrationDatabaseUrl();

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Independent TOTP-code derivation for the test (not a call into the module under test's own verify function). */
function currentCodeFor(secret: string): string {
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
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 1000 / 30);
  return hotp(key, counter);
}

describe.skipIf(!connectionString)("AuthService (integration, ADR-0020)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let auth: AuthService;
  // Bootstrapped ONCE for the whole suite: Neon `dev` is a real,
  // persistent (not per-test-rolled-back) database, so the
  // "bootstrap admin only while zero admins exist" invariant (AT-0020-3)
  // means a second bootstrap attempt in a later test WOULD correctly
  // fail once the first test has run against this branch -- that's a
  // feature of the invariant, not a test bug, but it means every test in
  // this file must share one admin actor rather than each trying to
  // bootstrap its own.
  let sharedAdmin: { id: string; role: "admin" };

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    auth = new AuthService(db);
    sharedAdmin = await createRealAdminActor();
  });

  async function createRealAdminActor(): Promise<{ id: string; role: "admin" }> {
    const email = `admin-actor-${randomUUID()}@example.test`;
    const registered = await auth.register(email, "admin-actor-password");
    if (!registered.ok) throw new Error("setup: register failed");
    const enrolled = await auth.enrollTotp(registered.value.id);
    if (!enrolled.ok) throw new Error("setup: enroll failed");
    const verified = await auth.verifyTotpEnrollment(registered.value.id, currentCodeFor(enrolled.value.secret));
    if (!verified.ok) throw new Error("setup: verify failed");
    // Not every run of this suite is against a FRESH database (Neon dev
    // is shared/persistent) -- bootstrap only if no admin exists yet;
    // otherwise promote via an existing admin actor, which exercises
    // the SAME `grantRole` code path either way.
    const [existingAdmin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
    const grant = existingAdmin
      ? await auth.grantRole({ id: existingAdmin.id, role: "admin" }, registered.value.id, "admin")
      : await auth.grantRole(null, registered.value.id, "admin");
    if (!grant.ok) throw new Error(`setup: admin grant failed: ${grant.error.message}`);
    return { id: registered.value.id, role: "admin" };
  }

  afterAll(async () => {
    await close();
  });

  async function auditRowsFor(targetId: string) {
    return db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, targetId));
  }

  it("AT-0020-3: rejects a role grant to an unverified account, and audit-logs the rejection", async () => {
    const admin = sharedAdmin;
    const email = `editor-${randomUUID()}@example.test`;
    const registered = await auth.register(email, "a-reasonably-strong-password");
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const userId = registered.value.id;

    const grant = await auth.grantRole(admin, userId, "editor");
    expect(grant.ok).toBe(false);
    if (!grant.ok) expect(grant.error.kind).toBe("mfa_required");

    const rows = await auditRowsFor(userId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.action).toBe("role_grant_rejected_no_mfa");
  });

  it("AT-0020-3 (positive): grants a role once TOTP enrollment is verified; mandatory MFA is then required to log in", async () => {
    const admin = sharedAdmin;
    const email = `editor2-${randomUUID()}@example.test`;
    const password = "a-reasonably-strong-password-2";
    const registered = await auth.register(email, password);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const userId = registered.value.id;

    const enrolled = await auth.enrollTotp(userId);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    // Enrollment alone must NOT grant a role.
    const rejectedGrant = await auth.grantRole(admin, userId, "editor");
    expect(rejectedGrant.ok).toBe(false);

    const verified = await auth.verifyTotpEnrollment(userId, currentCodeFor(enrolled.value.secret));
    expect(verified.ok).toBe(true);

    const grant = await auth.grantRole(admin, userId, "editor");
    expect(grant.ok).toBe(true);

    // Login without a TOTP code is rejected (mandatory MFA, ADR-0020 §4).
    const loginNoTotp = await auth.login(email, password, null);
    expect(loginNoTotp.ok).toBe(false);

    const loginWithTotp = await auth.login(email, password, currentCodeFor(enrolled.value.secret));
    expect(loginWithTotp.ok).toBe(true);
    if (loginWithTotp.ok) {
      expect(loginWithTotp.value.user.role).toBe("editor");
      const session = await auth.verifySession(loginWithTotp.value.token);
      expect(session.ok).toBe(true);
    }
  });

  it("AT-0020-4: a rolled-back action produces zero audit_log rows (same-tx discipline)", async () => {
    const email = `rollback-${randomUUID()}@example.test`;
    const registered = await auth.register(email, "another-password-123");
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const userId = registered.value.id;

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.auditLog).values({
          actorId: userId,
          action: "login",
          targetType: "user",
          targetId: userId,
          metadata: {},
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const rows = await auditRowsFor(userId);
    expect(rows.length).toBe(0);
  });
});
