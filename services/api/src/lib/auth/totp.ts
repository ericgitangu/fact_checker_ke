import { createHmac, randomBytes } from "node:crypto";

/**
 * ADR-0020 §4: mandatory TOTP MFA, hand-rolled per RFC 6238 (HMAC-SHA1,
 * 30s step, 6 digits) using only node:crypto — no third-party TOTP
 * library dependency, consistent with the ADR's "self-hosted, no vendor
 * metering" rationale extended to this primitive too. This is a
 * deliberate, narrow reimplementation of a well-specified standard
 * (RFC 6238 / RFC 4226), not "novel crypto" — verified against known
 * RFC 4226 Appendix D test vectors in the unit test suite.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpUri(secret: string, accountEmail: string, issuer = "fact_checker_ke"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Verifies `code` against `secret` allowing +/-1 time step (90s window) for clock drift. */
export function verifyTotpCode(secret: string, code: string, at: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret);
  const stepSeconds = 30;
  const counter = Math.floor(at / 1000 / stepSeconds);
  for (const drift of [0, -1, 1]) {
    if (hotp(key, counter + drift) === code) return true;
  }
  return false;
}

/** Exported for the RFC 4226 Appendix D test-vector unit test only. */
export function hotp(key: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // JS numbers are safe integers well past any realistic Unix-epoch
  // 30s-step counter (max safe integer / 30 is billions of years out).
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;
  const binCode = ((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3;
  const code = binCode % 1_000_000;
  return code.toString().padStart(6, "0");
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
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
