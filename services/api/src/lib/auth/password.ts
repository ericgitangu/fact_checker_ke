import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * ADR-0020 §4 (self-hosted auth): password hashing via node:crypto's
 * scrypt — no external auth library dependency for this primitive.
 * Format: `scrypt:<saltHex>:<hashHex>`, N=16384 (scrypt default cost),
 * 64-byte derived key (matches scryptSync's recommended keylen for its
 * default parameters).
 */
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  // timingSafeEqual throws on length mismatch rather than returning
  // false -- guard explicitly so a malformed stored hash can't throw
  // past this function into an unhandled-rejection 500.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
