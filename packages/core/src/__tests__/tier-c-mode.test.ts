import { describe, it, expect } from "vitest";
import { TierCModeSchema, tierCModeRelaxesBelowDefault, TIER_C_MODE_PROTECTION_RANK } from "../schemas/guidance.js";

/**
 * AT-0031-7/8: the Tier-C configurable spectrum's protection ordering.
 * Mode (a) is the default; mode (b) is stricter (never a relaxation);
 * mode (c) is the floor (the one relaxation that requires an
 * advocate-signoff reference at write time, see
 * services/api/src/lib/policy-audit.ts / tier-c-policy.ts).
 */
describe("ADR-0031 amendment: TierCMode protection ordering", () => {
  it("accepts exactly a, b, c", () => {
    expect(TierCModeSchema.safeParse("a").success).toBe(true);
    expect(TierCModeSchema.safeParse("b").success).toBe(true);
    expect(TierCModeSchema.safeParse("c").success).toBe(true);
    expect(TierCModeSchema.safeParse("d").success).toBe(false);
  });

  it("ranks mode (b) as more protective than the mode (a) default", () => {
    expect(TIER_C_MODE_PROTECTION_RANK.b).toBeGreaterThan(TIER_C_MODE_PROTECTION_RANK.a);
  });

  it("ranks mode (c) as less protective than the mode (a) default", () => {
    expect(TIER_C_MODE_PROTECTION_RANK.c).toBeLessThan(TIER_C_MODE_PROTECTION_RANK.a);
  });

  it("flags only mode (c) as a relaxation below the default", () => {
    expect(tierCModeRelaxesBelowDefault("a")).toBe(false);
    expect(tierCModeRelaxesBelowDefault("b")).toBe(false);
    expect(tierCModeRelaxesBelowDefault("c")).toBe(true);
  });
});
