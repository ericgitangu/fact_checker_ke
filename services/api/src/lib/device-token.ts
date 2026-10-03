import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { CapabilityTokenClaimsSchema, type CapabilityTokenClaims } from "@fact-checker-ke/core";

/**
 * ADR-0020 §1: a 256-bit opaque device token. The API only ever stores
 * `tokenHash` (sha256 of the raw token) — the raw `token` is returned
 * to the caller exactly once and never persisted, so a DB leak can't be
 * replayed as a bearer credential.
 */
export function generateDeviceToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const CAPABILITY_SCOPE = "submission:events" as const;

/**
 * ADR-0018/0020: a short-lived JWT scoped to exactly one submission id.
 * Minted at submission time (202 response), never valid cross-
 * submission (AT-0020-2) — enforced in `verifyCapabilityToken` by
 * comparing `sub` against the submission id the caller is requesting a
 * stream for, not just checking the signature.
 */
export async function signCapabilityToken(
  secret: string,
  submissionId: string,
  ttlSeconds = 90,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: CAPABILITY_SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(submissionId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key);
}

export type CapabilityVerifyResult =
  | { ok: true; claims: CapabilityTokenClaims }
  | { ok: false; reason: "invalid_signature" | "expired" | "wrong_submission" | "malformed" };

export async function verifyCapabilityToken(
  secret: string,
  token: string,
  expectedSubmissionId: string,
): Promise<CapabilityVerifyResult> {
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key);
    const parsed = CapabilityTokenClaimsSchema.safeParse({
      sub: payload.sub,
      scope: payload.scope,
      iat: payload.iat,
      exp: payload.exp,
    });
    if (!parsed.success) {
      return { ok: false, reason: "malformed" };
    }
    if (parsed.data.sub !== expectedSubmissionId) {
      return { ok: false, reason: "wrong_submission" };
    }
    return { ok: true, claims: parsed.data };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid_signature" };
  }
}
