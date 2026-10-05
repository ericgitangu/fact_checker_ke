import { describe, expect, it } from "vitest";
import { isActiveNow, projectEntitlement } from "../lib/entitlement.js";
import type { EntitlementRecord } from "../repositories/types.js";

const NOW = new Date("2026-10-05T12:00:00.000Z");

function record(overrides: Partial<EntitlementRecord>): EntitlementRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    deviceTokenHash: "dh_test",
    userId: null,
    tier: "premium",
    status: "active",
    provider: "paystack",
    providerRef: "sub_1",
    currentPeriodEnd: new Date("2026-11-05T00:00:00.000Z"),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("isActiveNow — the ad-free access decision (ADR-0012 §3)", () => {
  it("active + unexpired period ⇒ active", () => {
    expect(isActiveNow(record({}), NOW)).toBe(true);
  });

  it("active + NULL period (manual comp) ⇒ active (never expires)", () => {
    expect(isActiveNow(record({ provider: "manual", providerRef: null, currentPeriodEnd: null }), NOW)).toBe(true);
  });

  it("active but period already passed ⇒ NOT active (lapsed, not yet swept)", () => {
    expect(isActiveNow(record({ currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z") }), NOW)).toBe(false);
  });

  it("canceled but still inside the paid period ⇒ active until it ends", () => {
    expect(isActiveNow(record({ status: "canceled" }), NOW)).toBe(true);
  });

  it("expired status ⇒ never active", () => {
    expect(isActiveNow(record({ status: "expired" }), NOW)).toBe(false);
  });
});

describe("projectEntitlement — the public projection", () => {
  it("no record ⇒ fail-safe: ads ON, no perks", () => {
    const e = projectEntitlement(null, NOW);
    expect(e).toEqual({ premium: false, adFree: false, tier: null, status: null, currentPeriodEnd: null });
  });

  it("active record ⇒ premium + ad-free, tier surfaced", () => {
    const e = projectEntitlement(record({}), NOW);
    expect(e.premium).toBe(true);
    expect(e.adFree).toBe(true);
    expect(e.tier).toBe("premium");
    expect(e.status).toBe("active");
    expect(e.currentPeriodEnd).toBe("2026-11-05T00:00:00.000Z");
  });

  it("inactive record ⇒ not ad-free, tier hidden, but status/date kept for display", () => {
    const e = projectEntitlement(record({ status: "expired", currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z") }), NOW);
    expect(e.premium).toBe(false);
    expect(e.adFree).toBe(false);
    expect(e.tier).toBeNull();
    expect(e.status).toBe("expired");
    expect(e.currentPeriodEnd).toBe("2026-09-01T00:00:00.000Z");
  });
});
