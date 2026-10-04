import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIER_C_MODE_CONFIG,
  configRelaxesTierCBelowDefault,
  selectTierCMode,
  type TierCModeConfig,
} from "../lib/tier-c-policy.js";

/**
 * AT-0031-8: the Tier-C handling mode is configurable per
 * (tier, entity, topic, window); selecting mode (b) is never a
 * relaxation; any config that would land on mode (c) IS a relaxation
 * that must go through the advocate-signoff gate (exercised against a
 * real DB in policy-audit.integration.test.ts, which reuses
 * `updatePolicyFlag`'s `relaxesTierC` check — this file is the pure
 * selector-logic unit coverage).
 */
describe("ADR-0031 amendment AT-0031-8: selectTierCMode", () => {
  it("returns the default mode (a) with no rules and no selector match", () => {
    expect(selectTierCMode(DEFAULT_TIER_C_MODE_CONFIG, "C", {})).toBe("a");
  });

  it("matches a rule scoped to a specific entity", () => {
    const config: TierCModeConfig = {
      defaultMode: "a",
      rules: [{ entity: "Named Politician", mode: "b" }],
    };
    expect(selectTierCMode(config, "C", { entity: "Named Politician" })).toBe("b");
    expect(selectTierCMode(config, "C", { entity: "Someone Else" })).toBe("a");
  });

  it("matches a rule scoped to topic + window together (both axes must match)", () => {
    const config: TierCModeConfig = {
      defaultMode: "a",
      rules: [{ topic: "elections", window: "silence_period", mode: "b" }],
    };
    expect(selectTierCMode(config, "C", { topic: "elections", window: "silence_period" })).toBe("b");
    expect(selectTierCMode(config, "C", { topic: "elections", window: "normal" })).toBe("a");
  });

  it("first-match-wins when multiple rules could apply", () => {
    const config: TierCModeConfig = {
      defaultMode: "a",
      rules: [
        { entity: "X", mode: "b" },
        { entity: "X", mode: "c" },
      ],
    };
    expect(selectTierCMode(config, "C", { entity: "X" })).toBe("b");
  });
});

describe("ADR-0031 amendment AT-0031-8: configRelaxesTierCBelowDefault", () => {
  it("is false for the all-default config", () => {
    expect(configRelaxesTierCBelowDefault(DEFAULT_TIER_C_MODE_CONFIG)).toBe(false);
  });

  it("is false when every rule is mode (a) or (b) (never a relaxation)", () => {
    const config: TierCModeConfig = { defaultMode: "a", rules: [{ entity: "X", mode: "b" }] };
    expect(configRelaxesTierCBelowDefault(config)).toBe(false);
  });

  it("is true when the default mode itself is (c)", () => {
    const config: TierCModeConfig = { defaultMode: "c", rules: [] };
    expect(configRelaxesTierCBelowDefault(config)).toBe(true);
  });

  it("is true when any single rule sets mode (c), even if the default stays (a)", () => {
    const config: TierCModeConfig = { defaultMode: "a", rules: [{ entity: "X", mode: "c" }] };
    expect(configRelaxesTierCBelowDefault(config)).toBe(true);
  });
});
