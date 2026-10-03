import { describe, expect, it } from "vitest";
import {
  generateDeviceToken,
  hashDeviceToken,
  signCapabilityToken,
  verifyCapabilityToken,
} from "../lib/device-token.js";

describe("device token", () => {
  it("never persists the raw token — only its hash is derivable from it", () => {
    const { token, tokenHash } = generateDeviceToken();
    expect(hashDeviceToken(token)).toBe(tokenHash);
    expect(token).not.toBe(tokenHash);
  });

  it("two tokens never collide", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe("capability token (ADR-0018/0020)", () => {
  it("verifies for the submission it was minted for", async () => {
    const secret = "test-secret";
    const submissionId = "11111111-1111-4111-8111-111111111111";
    const token = await signCapabilityToken(secret, submissionId, 90);

    const result = await verifyCapabilityToken(secret, token, submissionId);
    expect(result.ok).toBe(true);
  });

  it("AT-0020-2: is rejected for a DIFFERENT submission id", async () => {
    const secret = "test-secret";
    const mintedFor = "11111111-1111-4111-8111-111111111111";
    const requestedFor = "22222222-2222-4222-8222-222222222222";
    const token = await signCapabilityToken(secret, mintedFor, 90);

    const result = await verifyCapabilityToken(secret, token, requestedFor);
    expect(result).toEqual({ ok: false, reason: "wrong_submission" });
  });

  it("is rejected once expired", async () => {
    const secret = "test-secret";
    const submissionId = "11111111-1111-4111-8111-111111111111";
    const token = await signCapabilityToken(secret, submissionId, -1);

    const result = await verifyCapabilityToken(secret, token, submissionId);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("is rejected when signed with a different secret", async () => {
    const submissionId = "11111111-1111-4111-8111-111111111111";
    const token = await signCapabilityToken("secret-a", submissionId, 90);

    const result = await verifyCapabilityToken("secret-b", token, submissionId);
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
