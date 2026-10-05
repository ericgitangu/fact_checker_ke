import { describe, expect, it } from "vitest";
import { shouldRenderAd } from "./ads";

/**
 * ADR-0012 §4 — the pure ad render decision. An ad shows ONLY when
 * configured + this placement has a slot + the reader isn't ad-free +
 * consent is satisfied. Every "unknown" path must fail safe to NOT
 * showing an ad.
 */
describe("shouldRenderAd", () => {
  const base = { client: "ca-pub-123", slotId: "999", adFree: false, consentSatisfied: true };

  it("renders when configured, free reader, consent satisfied", () => {
    expect(shouldRenderAd(base)).toBe(true);
  });

  it("hidden when AdSense client id is unset (invisible until owner configures)", () => {
    expect(shouldRenderAd({ ...base, client: undefined })).toBe(false);
  });

  it("hidden when this placement has no slot id (per-placement gating)", () => {
    expect(shouldRenderAd({ ...base, slotId: undefined })).toBe(false);
  });

  it("hidden for a Premium (ad-free) reader", () => {
    expect(shouldRenderAd({ ...base, adFree: true })).toBe(false);
  });

  it("hidden when consent is not satisfied (EEA/UK gate)", () => {
    expect(shouldRenderAd({ ...base, consentSatisfied: false })).toBe(false);
  });
});
