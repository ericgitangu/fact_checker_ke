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

/** Independent base32 decode for the test (not a call into the module under test's own verify function). */
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

/** Independent TOTP-code derivation for the test (not a call into the module under test's own verify function). */
function currentCodeFor(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return hotp(secretKeyFor(secret), counter);
}

/** Code for the step one ahead of "now" -- still inside the module's +/-1 drift window, but a DIFFERENT code than `currentCodeFor`'s (almost always; see test comment). */
function nextStepCodeFor(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30) + 1;
  return hotp(secretKeyFor(secret), counter);
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
      : await auth.grantRole({ id: registered.value.id, role: null }, registered.value.id, "admin");
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

    // SEC-3: the enrollment-verification code was already consumed above
    // -- reusing it here would now correctly be rejected as a replay, so
    // the login uses a DIFFERENT, not-yet-used code (one step ahead,
    // still inside the module's +/-1 drift window).
    const loginWithTotp = await auth.login(email, password, nextStepCodeFor(enrolled.value.secret));
    expect(loginWithTotp.ok).toBe(true);
    if (loginWithTotp.ok) {
      expect(loginWithTotp.value.user.role).toBe("editor");
      const session = await auth.verifySession(loginWithTotp.value.token);
      expect(session.ok).toBe(true);
    }
  });

  /**
   * SEC-1 (security-hardening finding #1, 2026-10-04): `grantRole`'s
   * bootstrap path used to accept ANY `targetUserId` whenever zero admins
   * existed, with no check that the grant was to the caller's OWN
   * account -- the docblock claimed "to themselves" but nothing enforced
   * it. Neon `dev` is shared/persistent (this suite's own `sharedAdmin`
   * already exists by the time this test runs), so a true zero-admin
   * window is reproduced here via an uncommitted transaction: every
   * existing admin is demoted for the lifetime of the transaction only,
   * the vulnerable/fixed code path is exercised for real against
   * Postgres, and the whole transaction is then forced to roll back so
   * the shared database is left exactly as it was.
   */
  it("SEC-1: a bootstrap grant (zero admins) is rejected when the target is NOT the caller's own account", async () => {
    await expect(
      db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        await tx.update(schema.users).set({ role: null }).where(eq(schema.users.role, "admin"));
        const txAuth = new AuthService(txDb);

        const caller = await txAuth.register(`sec1-caller-${randomUUID()}@example.test`, "caller-password-123");
        if (!caller.ok) throw new Error("setup: caller register failed");
        const callerEnrolled = await txAuth.enrollTotp(caller.value.id);
        if (!callerEnrolled.ok) throw new Error("setup: caller enroll failed");
        const callerVerified = await txAuth.verifyTotpEnrollment(caller.value.id, currentCodeFor(callerEnrolled.value.secret));
        if (!callerVerified.ok) throw new Error("setup: caller verify failed");

        const victim = await txAuth.register(`sec1-victim-${randomUUID()}@example.test`, "victim-password-123");
        if (!victim.ok) throw new Error("setup: victim register failed");
        const victimEnrolled = await txAuth.enrollTotp(victim.value.id);
        if (!victimEnrolled.ok) throw new Error("setup: victim enroll failed");
        const victimVerified = await txAuth.verifyTotpEnrollment(victim.value.id, currentCodeFor(victimEnrolled.value.secret));
        if (!victimVerified.ok) throw new Error("setup: victim verify failed");

        // THE VULNERABILITY: caller (not an admin, not the target) tries
        // to bootstrap-grant admin to a DIFFERENT, arbitrary MFA-verified
        // account while zero admins exist.
        const crossGrant = await txAuth.grantRole({ id: caller.value.id, role: null }, victim.value.id, "admin");
        expect(crossGrant.ok).toBe(false);
        if (!crossGrant.ok) expect(crossGrant.error.kind).toBe("forbidden");
        const [victimRow] = await tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, victim.value.id));
        expect(victimRow?.role ?? null).toBeNull();

        // The legitimate bootstrap path -- self-grant -- must still work
        // in the same zero-admin window.
        const selfGrant = await txAuth.grantRole({ id: caller.value.id, role: null }, caller.value.id, "admin");
        expect(selfGrant.ok).toBe(true);

        throw new Error("sec1-rollback-marker");
      }),
    ).rejects.toThrow("sec1-rollback-marker");
  });

  it("SEC-1b: once a real admin exists, a non-admin actor cannot grant admin/editor to any account, including themselves", async () => {
    const admin = sharedAdmin;
    const caller = await auth.register(`sec1b-caller-${randomUUID()}@example.test`, "caller-password-123");
    expect(caller.ok).toBe(true);
    if (!caller.ok) return;
    const callerEnrolled = await auth.enrollTotp(caller.value.id);
    expect(callerEnrolled.ok).toBe(true);
    if (!callerEnrolled.ok) return;
    const callerVerified = await auth.verifyTotpEnrollment(caller.value.id, currentCodeFor(callerEnrolled.value.secret));
    expect(callerVerified.ok).toBe(true);

    // Non-admin actor attempting to self-grant once a real admin already
    // exists -- the "zero admin" bootstrap window is long closed.
    const selfGrant = await auth.grantRole({ id: caller.value.id, role: null }, caller.value.id, "admin");
    expect(selfGrant.ok).toBe(false);
    if (!selfGrant.ok) expect(selfGrant.error.kind).toBe("forbidden");

    // Sanity: the real admin actor still CAN grant (unaffected by the fix).
    const legit = await auth.register(`sec1b-legit-${randomUUID()}@example.test`, "legit-password-123");
    expect(legit.ok).toBe(true);
    if (!legit.ok) return;
    const legitEnrolled = await auth.enrollTotp(legit.value.id);
    expect(legitEnrolled.ok).toBe(true);
    if (!legitEnrolled.ok) return;
    const legitVerified = await auth.verifyTotpEnrollment(legit.value.id, currentCodeFor(legitEnrolled.value.secret));
    expect(legitVerified.ok).toBe(true);
    const legitGrant = await auth.grantRole(admin, legit.value.id, "editor");
    expect(legitGrant.ok).toBe(true);
  });

  /**
   * SEC-3 (security-hardening finding #3, 2026-10-04): `verifyTotpCode`
   * accepted a valid code for its ENTIRE +/-1 step (90s) window with no
   * single-use tracking -- the same code could be replayed any number of
   * times within that window, across both enrollment and login. The fix
   * records (userId, counter) on first use and rejects reuse.
   */
  it("SEC-3: a valid TOTP code is accepted once, then rejected on immediate reuse (replay) across enroll and login", async () => {
    const email = `totp-replay-${randomUUID()}@example.test`;
    const password = "totp-replay-password-1";
    const registered = await auth.register(email, password);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const userId = registered.value.id;

    const enrolled = await auth.enrollTotp(userId);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    const code = currentCodeFor(enrolled.value.secret);

    // First use: consumed by enrollment verification.
    const verified = await auth.verifyTotpEnrollment(userId, code);
    expect(verified.ok).toBe(true);

    // Replay: the SAME code, still well inside its +/-1 step validity
    // window, must be rejected when presented again at login.
    const loginReplay = await auth.login(email, password, code);
    expect(loginReplay.ok).toBe(false);

    // A DIFFERENT, not-yet-used code (one step ahead, still inside the
    // module's drift window) must still work -- the fix rejects reuse of
    // a specific counter, not every code for the account.
    const freshCode = nextStepCodeFor(enrolled.value.secret);
    const loginFresh = await auth.login(email, password, freshCode);
    expect(loginFresh.ok).toBe(true);

    // And THAT code, now consumed, must itself be rejected on replay.
    const secondReplay = await auth.login(email, password, freshCode);
    expect(secondReplay.ok).toBe(false);
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
