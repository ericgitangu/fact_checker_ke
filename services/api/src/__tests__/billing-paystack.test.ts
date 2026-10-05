import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PaystackBillingProvider } from "../lib/billing/paystack.js";

const SECRET = "sk_test_scaffold_only_not_a_real_key";

function sign(rawBody: string, secret = SECRET): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

describe("PaystackBillingProvider.verifyWebhook (HMAC-SHA512, buildable now)", () => {
  const provider = new PaystackBillingProvider(SECRET);

  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 1, reference: "ref_1", status: "success" } });
    expect(provider.verifyWebhook({ rawBody: body, signature: sign(body) })).toBe(true);
  });

  it("rejects a body signed with the wrong secret", () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 1 } });
    expect(provider.verifyWebhook({ rawBody: body, signature: sign(body, "wrong-secret") })).toBe(false);
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const original = JSON.stringify({ event: "charge.success", data: { id: 1, amount: 100 } });
    const signature = sign(original);
    const tampered = JSON.stringify({ event: "charge.success", data: { id: 1, amount: 999999 } });
    expect(provider.verifyWebhook({ rawBody: tampered, signature })).toBe(false);
  });

  it("rejects a missing signature", () => {
    const body = JSON.stringify({ event: "charge.success", data: {} });
    expect(provider.verifyWebhook({ rawBody: body, signature: undefined })).toBe(false);
  });

  it("fails CLOSED when unconfigured (no secret): never verifies", () => {
    const unconfigured = new PaystackBillingProvider(null);
    const body = JSON.stringify({ event: "charge.success", data: {} });
    // Even a body "signed" with the empty-string key must not verify.
    expect(unconfigured.verifyWebhook({ rawBody: body, signature: sign(body) })).toBe(false);
    expect(unconfigured.configured).toBe(false);
  });
});

describe("PaystackBillingProvider.parseEvent (normalisation, buildable now)", () => {
  const provider = new PaystackBillingProvider(SECRET);

  it("extracts id/type/reference/subject and grants premium on charge.success", () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        id: 302961,
        reference: "ref_abc",
        status: "success",
        metadata: { subjectRef: "dh_subject_1", tier: "premium" },
      },
    });
    const parsed = provider.parseEvent(body);
    expect(parsed).toEqual({
      eventId: "302961",
      eventType: "charge.success",
      reference: "ref_abc",
      subjectRef: "dh_subject_1",
      grantsPremium: true,
      currentPeriodEnd: null,
    });
  });

  it("does NOT grant premium on a failed charge", () => {
    const body = JSON.stringify({ event: "charge.failed", data: { id: 1, reference: "r", status: "failed" } });
    expect(provider.parseEvent(body)?.grantsPremium).toBe(false);
  });

  it("carries next_payment_date as the period end for a subscription", () => {
    const body = JSON.stringify({
      event: "subscription.create",
      data: { subscription_code: "SUB_x", next_payment_date: "2026-11-05T00:00:00.000Z", metadata: { subjectRef: "dh" } },
    });
    const parsed = provider.parseEvent(body);
    expect(parsed?.grantsPremium).toBe(true);
    expect(parsed?.reference).toBe("SUB_x");
    expect(parsed?.currentPeriodEnd?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("returns null for unparseable JSON", () => {
    expect(provider.parseEvent("{not json")).toBeNull();
  });
});

describe("PaystackBillingProvider.createCheckout (needs owner account — fail-closed stub)", () => {
  it("is not_configured when the secret is unset", async () => {
    const result = await new PaystackBillingProvider(null).createCheckout({ tier: "premium", subjectRef: "dh" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_configured");
  });

  it("is not_implemented when configured (NEVER calls a live payments API in this scaffold)", async () => {
    const result = await new PaystackBillingProvider(SECRET).createCheckout({ tier: "premium", subjectRef: "dh" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_implemented");
  });
});
