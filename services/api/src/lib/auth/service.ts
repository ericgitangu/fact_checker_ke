import { randomBytes, createHash } from "node:crypto";
import { eq, count } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { Role } from "@fact-checker-ke/core";
import { hashPassword, verifyPassword } from "./password.js";
import { generateTotpSecret, matchTotpCounter, totpUri } from "./totp.js";
import { writeAuditLog } from "../audit.js";

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

export interface SessionUser {
  id: string;
  email: string;
  role: Role | null;
  mfaEnabled: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * ADR-0020 §4: self-hosted (Neon-backed) editor/admin/moderator identity
 * service. Deliberately NOT the `better-auth` npm package (see
 * docs/adr/0020's additive implementation notes below this file's
 * caller for the full rationale) — a minimal, auditable, dependency-free
 * implementation of the exact same decision (self-hosted, TOTP MFA
 * mandatory, no vendor MAU metering), chosen because pulling in a large
 * third-party auth framework's full adapter surface inside this change's
 * time/verification budget would trade a verified, test-covered
 * implementation for an unverified integration. Tracked as tech debt:
 * swapping in `better-auth` itself later is additive (same tables,
 * different code calling them) if its plugin ecosystem (passkeys, OAuth)
 * becomes a real requirement.
 */
export class AuthService {
  constructor(private readonly db: Database) {}

  async register(email: string, password: string): Promise<AuthResult<{ id: string; email: string }>> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      return { ok: false, error: { kind: "conflict", message: "An account with this email already exists." } };
    }
    const [row] = await this.db
      .insert(schema.users)
      .values({ email: normalizedEmail, passwordHash: hashPassword(password), role: null, mfaEnabled: false })
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!row) throw new Error("Insert into users returned no row");
    return { ok: true, value: row };
  }

  async enrollTotp(userId: string): Promise<AuthResult<{ secret: string; uri: string }>> {
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) return { ok: false, error: { kind: "not_found", message: "No such user." } };

    const secret = generateTotpSecret();
    await this.db
      .insert(schema.totpSecrets)
      .values({ userId, secretBase32: secret, verifiedAt: null })
      .onConflictDoUpdate({ target: schema.totpSecrets.userId, set: { secretBase32: secret, verifiedAt: null } });

    return { ok: true, value: { secret, uri: totpUri(secret, user.email) } };
  }

  /** AT-0020-3 depends on this: role.mfaEnabled only flips true here, never on enroll alone. */
  async verifyTotpEnrollment(userId: string, code: string): Promise<AuthResult<{ verified: true }>> {
    const [row] = await this.db.select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId)).limit(1);
    if (!row) return { ok: false, error: { kind: "not_found", message: "No TOTP enrollment in progress." } };
    if (!(await this.verifyAndConsumeTotpCode(userId, row.secretBase32, code))) {
      return { ok: false, error: { kind: "invalid_code", message: "Invalid, expired, or already-used TOTP code." } };
    }

    await this.db.transaction(async (tx) => {
      await tx.update(schema.totpSecrets).set({ verifiedAt: new Date() }).where(eq(schema.totpSecrets.userId, userId));
      await tx.update(schema.users).set({ mfaEnabled: true }).where(eq(schema.users.id, userId));
      await writeAuditLog(tx, { actorId: userId, action: "totp_verified", targetType: "user", targetId: userId });
    });

    return { ok: true, value: { verified: true } };
  }

  /**
   * ADR-0020 §4 / AT-0020-3: rejected unless the TARGET has verified
   * MFA. The bootstrap path (zero admins exist yet) is allowed ONLY
   * when the AUTHENTICATED caller grants `admin` to THEMSELVES — this
   * is the documented, narrow answer to "who grants the first admin"
   * without a side-channel seed script. `actor` is always a real,
   * authenticated identity (the caller's own session); there is no
   * "fully unauthenticated" path — that was SEC-1 (2026-10-04
   * security-hardening finding #1): a caller with no session at all
   * could previously bootstrap-grant admin to an ARBITRARY other
   * MFA-verified userId, not just to itself, as long as zero admins
   * existed. The invariant enforced below is self-grant-only during the
   * bootstrap window, not merely "zero admins exist" — once a real
   * admin exists, only that admin's session may grant any role at all.
   */
  async grantRole(
    actor: { id: string; role: Role | null },
    targetUserId: string,
    role: Role,
  ): Promise<AuthResult<{ granted: true }>> {
    const [target] = await this.db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).limit(1);
    if (!target) return { ok: false, error: { kind: "not_found", message: "No such user." } };

    if (!target.mfaEnabled) {
      await this.db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorId: actor.id,
          action: "role_grant_rejected_no_mfa",
          targetType: "user",
          targetId: targetUserId,
          metadata: { requestedRole: role },
        });
      });
      return { ok: false, error: { kind: "mfa_required", message: "Target account has no verified TOTP enrollment." } };
    }

    const [row] = await this.db.select({ n: count() }).from(schema.users).where(eq(schema.users.role, "admin"));
    const adminCount = row?.n ?? 0;
    const isBootstrapWindow = adminCount === 0;

    if (isBootstrapWindow) {
      // SEC-1: bootstrap may ONLY self-grant admin to the caller's own,
      // freshly-enrolled account — never an arbitrary other userId,
      // even though zero admins exist yet.
      if (role !== "admin" || actor.id !== targetUserId) {
        await this.db.transaction(async (tx) => {
          await writeAuditLog(tx, {
            actorId: actor.id,
            action: "role_grant_rejected_bootstrap_scope",
            targetType: "user",
            targetId: targetUserId,
            metadata: { requestedRole: role },
          });
        });
        return {
          ok: false,
          error: {
            kind: "forbidden",
            message: "Bootstrap role grant is only valid for the caller's own account while no admin exists yet.",
          },
        };
      }
    } else if (actor.role !== "admin") {
      return { ok: false, error: { kind: "forbidden", message: "Only an admin may grant roles." } };
    }

    await this.db.transaction(async (tx) => {
      await tx.update(schema.users).set({ role }).where(eq(schema.users.id, targetUserId));
      await writeAuditLog(tx, {
        actorId: actor.id,
        action: "role_granted",
        targetType: "user",
        targetId: targetUserId,
        metadata: { grantedRole: role, bootstrap: isBootstrapWindow },
      });
    });

    return { ok: true, value: { granted: true } };
  }

  async login(
    email: string,
    password: string,
    totpCode: string | null,
  ): Promise<AuthResult<{ token: string; user: SessionUser }>> {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail)).limit(1);

    const fail = async (reason: string) => {
      await this.db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorId: user?.id ?? null,
          action: "login_failed",
          targetType: "user",
          targetId: user?.id ?? null,
          metadata: { reason },
        });
      });
      return { ok: false as const, error: { kind: "invalid_credentials", message: "Invalid email, password, or TOTP code." } };
    };

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return fail("bad_password_or_unknown_email");
    }
    // ADR-0020 §4: "MFA (TOTP) is mandatory for both [editor and admin]".
    // A user with a granted role but mfaEnabled=false should be
    // unreachable (grantRole refuses it) — this check is defense in
    // depth, not the primary enforcement point.
    if (user.mfaEnabled) {
      if (!totpCode || !(await this.verifyLoginTotp(user.id, totpCode))) {
        return fail("missing_or_invalid_totp");
      }
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.sessions).values({ tokenHash, userId: user.id, expiresAt });
      await writeAuditLog(tx, { actorId: user.id, action: "login", targetType: "user", targetId: user.id });
    });

    return {
      ok: true,
      value: {
        token: rawToken,
        user: { id: user.id, email: user.email, role: user.role, mfaEnabled: user.mfaEnabled },
      },
    };
  }

  private async verifyLoginTotp(userId: string, code: string): Promise<boolean> {
    const [row] = await this.db.select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, userId)).limit(1);
    if (!row || !row.verifiedAt) return false;
    return this.verifyAndConsumeTotpCode(userId, row.secretBase32, code);
  }

  /**
   * SEC-3 (security-hardening finding #3, 2026-10-04): verifies `code`
   * against `secret` AND atomically consumes the matched (userId,
   * counter) pair so the same code can never be accepted twice, across
   * BOTH enrollment-verification and login call sites (the replay store
   * is keyed by userId, not by which endpoint is calling). A duplicate
   * insert for an already-consumed counter (`ON CONFLICT DO NOTHING`,
   * checked by rows-returned) is the replay rejection.
   */
  private async verifyAndConsumeTotpCode(userId: string, secret: string, code: string): Promise<boolean> {
    const counter = matchTotpCounter(secret, code);
    if (counter === null) return false;
    const inserted = await this.db
      .insert(schema.totpUsedCodes)
      .values({ userId, counter })
      .onConflictDoNothing({ target: [schema.totpUsedCodes.userId, schema.totpUsedCodes.counter] })
      .returning({ id: schema.totpUsedCodes.id });
    return inserted.length > 0;
  }

  async logout(rawToken: string): Promise<void> {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(rawToken)));
  }

  async verifySession(rawToken: string): Promise<AuthResult<SessionUser>> {
    const tokenHash = hashToken(rawToken);
    const [row] = await this.db
      .select({
        userId: schema.sessions.userId,
        expiresAt: schema.sessions.expiresAt,
        email: schema.users.email,
        role: schema.users.role,
        mfaEnabled: schema.users.mfaEnabled,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .limit(1);

    if (!row || row.expiresAt.getTime() < Date.now()) {
      return { ok: false, error: { kind: "unauthorized", message: "Invalid or expired session." } };
    }
    return { ok: true, value: { id: row.userId, email: row.email, role: row.role, mfaEnabled: row.mfaEnabled } };
  }
}
