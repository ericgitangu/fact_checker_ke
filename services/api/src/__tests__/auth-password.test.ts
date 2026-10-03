import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";

describe("password hashing (scrypt, node:crypto only)", () => {
  it("round-trips a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("never stores the plaintext password in the stored hash string", () => {
    const stored = hashPassword("super-secret-plaintext");
    expect(stored).not.toContain("super-secret-plaintext");
  });

  it("produces a different salt (and hash) for two hashes of the same password", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects a malformed stored hash without throwing", () => {
    expect(verifyPassword("anything", "not-a-valid-stored-hash")).toBe(false);
  });
});
