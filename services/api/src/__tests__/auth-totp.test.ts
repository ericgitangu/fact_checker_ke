import { describe, expect, it } from "vitest";
import { generateTotpSecret, hotp, totpUri, verifyTotpCode } from "../lib/auth/totp.js";

describe("TOTP/HOTP (RFC 6238 / RFC 4226, node:crypto only)", () => {
  it("matches RFC 4226 Appendix D HOTP test vectors for secret '12345678901234567890'", () => {
    const key = Buffer.from("12345678901234567890", "ascii");
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => {
      expect(hotp(key, counter)).toBe(code);
    });
  });

  it("verifyTotpCode accepts the code generated for the current time step", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / 30);
    const key = base32DecodeForTest(secret);
    const code = hotp(key, step);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });

  it("verifyTotpCode rejects a code far outside the drift window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const key = base32DecodeForTest(secret);
    const farFutureCode = hotp(key, Math.floor(now / 1000 / 30) + 10);
    expect(verifyTotpCode(secret, farFutureCode, now)).toBe(false);
  });

  it("verifyTotpCode rejects a non-6-digit string without throwing", () => {
    expect(verifyTotpCode(generateTotpSecret(), "abc")).toBe(false);
  });

  it("totpUri embeds the account email and issuer for an authenticator app to scan", () => {
    const uri = totpUri("ABCDEFGHIJKLMNOP", "editor@example.com");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(encodeURIComponent("editor@example.com"));
    expect(uri).toContain("secret=ABCDEFGHIJKLMNOP");
  });
});

// Local re-implementation of base32 decode, kept separate from the
// module under test so this test doesn't just re-run the same code
// against itself for the "generated secret round-trips" assertions.
function base32DecodeForTest(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.toUpperCase()) {
    const idx = alphabet.indexOf(char);
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
