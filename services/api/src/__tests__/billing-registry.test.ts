import { describe, expect, it } from "vitest";
import { createBillingRegistry } from "../lib/billing/registry.js";
import type { MpesaConfig, StripeConfig } from "../config.js";

const mpesa: MpesaConfig = {
  consumerKey: "ck",
  consumerSecret: "cs",
  shortcode: "174379",
  passkey: "pk",
  env: "sandbox",
  callbackUrl: "https://x.test/cb",
  callbackIpAllowlist: ["127.0.0.1"],
  amountKes: 200,
};
const stripe: StripeConfig = { secretKey: "sk_test", webhookSecret: "whsec", priceId: "price_1" };

describe("createBillingRegistry (ADR-0012 monetization v2)", () => {
  it("registers paystack, mpesa and stripe adapters", () => {
    const reg = createBillingRegistry({ paystackSecretKey: "sk_live", mpesa, stripe });
    expect(reg.get("paystack")?.provider).toBe("paystack");
    expect(reg.get("mpesa")?.provider).toBe("mpesa");
    expect(reg.get("stripe")?.provider).toBe("stripe");
  });

  it("returns null for the manual (non-checkout) and unknown providers", () => {
    const reg = createBillingRegistry({ paystackSecretKey: null, mpesa, stripe });
    expect(reg.get("manual")).toBeNull();
    expect(reg.get("nope")).toBeNull();
  });

  it("registers the adapters even when unconfigured (routes exist, fail closed)", () => {
    const reg = createBillingRegistry({
      paystackSecretKey: null,
      mpesa: { ...mpesa, consumerKey: null, passkey: null },
      stripe: { secretKey: null, webhookSecret: null, priceId: null },
    });
    expect(reg.get("mpesa")?.configured).toBe(false);
    expect(reg.get("stripe")?.configured).toBe(false);
  });

  it("omits mpesa/stripe only when their config block is absent entirely", () => {
    const reg = createBillingRegistry({ paystackSecretKey: null });
    expect(reg.get("paystack")).not.toBeNull();
    expect(reg.get("mpesa")).toBeNull();
    expect(reg.get("stripe")).toBeNull();
  });

  it("defaults the checkout provider to paystack", () => {
    const reg = createBillingRegistry({ paystackSecretKey: null });
    expect(reg.defaultProvider).toBe("paystack");
  });
});
