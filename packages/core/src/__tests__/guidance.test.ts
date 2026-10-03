import { describe, it, expect } from "vitest";
import { CheckSchema } from "../schemas/check.js";
import { assertClaimAndEvidenceFraming, FramingViolationError, isBareIndictmentFraming } from "../schemas/guidance.js";

/**
 * AT-0031-1: A published result carries `calibrated_confidence` +
 * `what_would_change_this` + cited evidence, and never renders a bare
 * "[Name] lied" (framing enforced).
 */
const basePublishedCheck = {
  id: "11111111-1111-4111-8111-111111111111",
  submissionId: "22222222-2222-4222-8222-222222222222",
  summary: "The evidence we found does not support this claim about fuel prices.",
  rating: "False" as const,
  claims: [],
  sources: [],
  isDraft: false,
  reviewedBy: "editor-1",
  createdAt: "2026-10-03T00:00:00.000Z",
  publishedAt: "2026-10-03T01:00:00.000Z",
  calibratedConfidence: 0.92,
  whatWouldChangeThis: "A corrected EPRA pricing circular.",
  evidence: [{ sourceId: "33333333-3333-4333-8333-333333333333", quote: "EPRA pricing guidance, Sept 2026" }],
  riskTier: "A" as const,
};

describe("ADR-0031 AT-0031-1: published Check output model", () => {
  it("accepts a published check that carries calibrated_confidence + what_would_change_this + evidence with claim-and-evidence framing", () => {
    const result = CheckSchema.safeParse(basePublishedCheck);
    expect(result.success).toBe(true);
  });

  it("rejects a published check with no calibrated_confidence", () => {
    const result = CheckSchema.safeParse({ ...basePublishedCheck, calibratedConfidence: null });
    expect(result.success).toBe(false);
  });

  it("rejects a published check with no what_would_change_this", () => {
    const result = CheckSchema.safeParse({ ...basePublishedCheck, whatWouldChangeThis: null });
    expect(result.success).toBe(false);
  });

  it("rejects a published check with no cited evidence", () => {
    const result = CheckSchema.safeParse({ ...basePublishedCheck, evidence: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a published check whose summary is a bare person-indicting verdict instead of claim-and-evidence framing", () => {
    const result = CheckSchema.safeParse({
      ...basePublishedCheck,
      summary: "MP Jane Doe lied about the fuel price freeze.",
    });
    expect(result.success).toBe(false);
  });

  it("allows a draft (unpublished) check to omit all four ADR-0031 fields", () => {
    const result = CheckSchema.safeParse({
      ...basePublishedCheck,
      isDraft: true,
      publishedAt: null,
      calibratedConfidence: null,
      whatWouldChangeThis: null,
      evidence: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("isBareIndictmentFraming / assertClaimAndEvidenceFraming", () => {
  it.each([
    "MP Jane Doe lied about the figures.",
    "The senator is a liar.",
    "The governor is corrupt.",
    "He committed fraud against taxpayers.",
    "She is a criminal.",
    "The minister stole public funds.",
    "The chief is guilty.",
  ])("flags %p as a bare indictment", (summary) => {
    expect(isBareIndictmentFraming(summary)).toBe(true);
    expect(() => assertClaimAndEvidenceFraming(summary)).toThrow(FramingViolationError);
  });

  it("does not flag claim-and-evidence framing", () => {
    const summary = "The evidence we found does not support this claim — confidence 0.92, see cited sources.";
    expect(isBareIndictmentFraming(summary)).toBe(false);
    expect(() => assertClaimAndEvidenceFraming(summary)).not.toThrow();
  });
});
