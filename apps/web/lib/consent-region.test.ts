import { describe, expect, it } from "vitest";
import { countryRequiresConsent, CONSENT_REQUIRED_COUNTRIES } from "./consent-region";

/**
 * ADR-0012 §4 (monetization v2) — the AUTHORITATIVE server-side region
 * decision from `x-vercel-ip-country`, replacing the client timezone guess.
 * Three-valued: true (EEA/UK), false (known non-EEA), null (no signal →
 * caller falls back to the client heuristic, never silently "allow").
 */
describe("countryRequiresConsent", () => {
  it("requires consent for EEA + UK countries (case-insensitive)", () => {
    for (const code of ["DE", "FR", "IE", "GB", "NO", "IS", "LI", "it", "es"]) {
      expect(countryRequiresConsent(code)).toBe(true);
    }
  });

  it("does NOT require consent for a known non-EEA country", () => {
    for (const code of ["KE", "US", "NG", "ZA", "IN", "CH" /* Switzerland is opt-out, excluded */]) {
      expect(countryRequiresConsent(code)).toBe(false);
    }
  });

  it("returns null (no signal → fall back to client heuristic) when geo is absent/unknown", () => {
    expect(countryRequiresConsent(null)).toBeNull();
    expect(countryRequiresConsent(undefined)).toBeNull();
    expect(countryRequiresConsent("")).toBeNull();
    expect(countryRequiresConsent("  ")).toBeNull();
    expect(countryRequiresConsent("XX")).toBeNull();
  });

  it("covers the full EU-27 + EEA + UK set (27 + 3 + 1)", () => {
    expect(CONSENT_REQUIRED_COUNTRIES.size).toBe(31);
  });
});
