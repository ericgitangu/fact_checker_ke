import { describe, expect, it } from "vitest";
import {
  BillingProviderSchema,
  CheckoutInputSchema,
  CheckoutResultSchema,
  EntitlementSchema,
  EntitlementStatusSchema,
  EntitlementTierSchema,
  NO_ENTITLEMENT,
} from "../schemas/entitlement.js";

describe("entitlement contracts (ADR-0012 §3)", () => {
  it("enumerates exactly the tiers / statuses / providers the schema promises", () => {
    expect(EntitlementTierSchema.options).toEqual(["premium"]);
    expect(EntitlementStatusSchema.options).toEqual(["active", "expired", "canceled"]);
    expect(BillingProviderSchema.options).toEqual(["paystack", "stripe", "manual"]);
  });

  it("NO_ENTITLEMENT is the fail-safe projection: ads ON, no perks", () => {
    expect(() => EntitlementSchema.parse(NO_ENTITLEMENT)).not.toThrow();
    expect(NO_ENTITLEMENT.premium).toBe(false);
    expect(NO_ENTITLEMENT.adFree).toBe(false);
    expect(NO_ENTITLEMENT.tier).toBeNull();
  });

  it("accepts a well-formed active premium entitlement", () => {
    const parsed = EntitlementSchema.parse({
      premium: true,
      adFree: true,
      tier: "premium",
      status: "active",
      currentPeriodEnd: "2026-11-05T00:00:00.000Z",
    });
    expect(parsed.tier).toBe("premium");
  });

  it("rejects a non-ISO currentPeriodEnd", () => {
    const result = EntitlementSchema.safeParse({
      premium: true,
      adFree: true,
      tier: "premium",
      status: "active",
      currentPeriodEnd: "next tuesday",
    });
    expect(result.success).toBe(false);
  });

  it("CheckoutInput defaults to premium/paystack and never takes a subject from the body", () => {
    const parsed = CheckoutInputSchema.parse({});
    expect(parsed.tier).toBe("premium");
    expect(parsed.provider).toBe("paystack");
    // The subject is server-derived (X-Device-Token), so the input schema
    // must have no subject field to spoof.
    expect(Object.keys(parsed).sort()).toEqual(["provider", "tier"]);
  });

  it("CheckoutResult requires an https authorization URL + opaque reference", () => {
    expect(() =>
      CheckoutResultSchema.parse({
        provider: "paystack",
        authorizationUrl: "https://checkout.paystack.com/abc123",
        reference: "ref_abc123",
      }),
    ).not.toThrow();
    expect(
      CheckoutResultSchema.safeParse({
        provider: "paystack",
        authorizationUrl: "not-a-url",
        reference: "ref_abc123",
      }).success,
    ).toBe(false);
  });
});
