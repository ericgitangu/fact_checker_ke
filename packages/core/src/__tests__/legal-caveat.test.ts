import { describe, expect, it } from "vitest";
import {
  ADVOCATE_SIGNOFF_COMPLETE,
  BANNED_FRAMING_REFERENCES,
  BANNED_PERSON_INDICTING_PHRASES,
  EU_CROSS_BORDER_DISCLOSURE,
  PRIVACY_RETENTION_CLASSES,
  PRIVACY_SECTIONS,
  STANDING_CAVEAT_LONG,
  STANDING_CAVEAT_SHORT,
  TERMS_SECTIONS,
  TIER_C_INLINE_CAVEAT,
} from "../legal/caveat.js";
import { isBareIndictmentFraming } from "../schemas/guidance.js";

/**
 * ADR-0033 AT-0033-1: the standing caveat text comes from one source
 * string and is snapshot/contract-tested so it cannot silently regress.
 *
 * Both a `toMatchSnapshot` (so ANY future edit to the wording shows up as
 * an explicit, reviewable diff in `__snapshots__/legal-caveat.test.ts.snap`)
 * AND hardcoded `toBe` assertions on the load-bearing sentences (so even a
 * snapshot-update-without-review cannot silently drift the exact wording
 * the ADR specifies verbatim) back this test.
 */
describe("ADR-0033 AT-0033-1: standing caveat (short form)", () => {
  it("matches the ADR-0033 §A snapshot", () => {
    expect(STANDING_CAVEAT_SHORT).toMatchSnapshot();
  });

  it("heading is exactly the ADR-0033 §A verbatim text", () => {
    expect(STANDING_CAVEAT_SHORT.heading).toBe(
      "AI-assisted assessment · pilot · not a verdict on any person.",
    );
  });

  it("body states: not a statement of fact, no warranty, right of reply", () => {
    expect(STANDING_CAVEAT_SHORT.body).toContain("We assess the claim, not the person.");
    expect(STANDING_CAVEAT_SHORT.body).toContain(
      "not a statement of fact about any individual, not legal or professional advice",
    );
    expect(STANDING_CAVEAT_SHORT.body).toContain("no warranty of accuracy or completeness");
    expect(STANDING_CAVEAT_SHORT.body).toContain("right of reply and correction");
  });
});

describe("ADR-0033 §A: standing caveat (long form)", () => {
  it("matches the ADR-0033 snapshot", () => {
    expect(STANDING_CAVEAT_LONG).toMatchSnapshot();
  });

  it("carries the one unresolved [ADVOCATE: ...] marker from the ADR, not silently resolved", () => {
    const researchSection = STANDING_CAVEAT_LONG.find((s) => s.id === "research-educational");
    expect(researchSection?.advocateMarker).toMatch(/^\[ADVOCATE:/);
    expect(researchSection?.advocateMarker).toContain("ADR-0031 tension");
  });

  it("every other long-form element has no advocate marker (not every clause is open)", () => {
    const withoutMarker = STANDING_CAVEAT_LONG.filter((s) => s.id !== "research-educational");
    for (const section of withoutMarker) {
      expect("advocateMarker" in section).toBe(false);
    }
  });
});

/**
 * AT-0033-2: nothing here is served live until an advocate signs off.
 */
describe("ADR-0033 AT-0033-2: advocate sign-off gate", () => {
  it("ADVOCATE_SIGNOFF_COMPLETE is false (no sign-off has happened yet)", () => {
    expect(ADVOCATE_SIGNOFF_COMPLETE).toBe(false);
  });
});

/**
 * AT-0033-4: Tier-C inline framing is claim-attributed and open-question,
 * never a declarative person-directed statement -- reuses
 * `isBareIndictmentFraming` (ADR-0031/ADR-0023's own lexical guard) rather
 * than re-deriving the rule, so this test exercises the real check, not a
 * replica of it.
 */
describe("ADR-0033 AT-0033-4: Tier-C inline caveat framing", () => {
  it("is not flagged as bare person-indicting framing", () => {
    expect(isBareIndictmentFraming(TIER_C_INLINE_CAVEAT.body)).toBe(false);
  });

  it("contains none of the banned person-indicting phrases", () => {
    for (const phrase of BANNED_PERSON_INDICTING_PHRASES) {
      expect(TIER_C_INLINE_CAVEAT.body.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("states a right of reply, not a verdict", () => {
    expect(TIER_C_INLINE_CAVEAT.body).toContain("right of reply");
  });
});

/**
 * AT-0033-5: no rendered copy anywhere in this module references the
 * (incorrect) "CNN Facts First rating scale" framing.
 */
describe("ADR-0033 AT-0033-5: no CNN Facts First rating-scale reference", () => {
  const allCopy = JSON.stringify({
    STANDING_CAVEAT_SHORT,
    STANDING_CAVEAT_LONG,
    TIER_C_INLINE_CAVEAT,
    TERMS_SECTIONS,
    PRIVACY_SECTIONS,
  });

  it("contains none of the banned framing references", () => {
    for (const banned of BANNED_FRAMING_REFERENCES) {
      expect(allCopy).not.toContain(banned);
    }
  });
});

/**
 * AT-0033-6: the Privacy Policy's cross-border disclosure is verbatim, the
 * retention table mirrors ADR-0021, and the liability copy does not claim
 * to protect against a non-party third-party claim (no false "this
 * protects us from defamation" wording).
 */
describe("ADR-0033 AT-0033-6: Privacy Policy / Terms copy-lint", () => {
  it("EU_CROSS_BORDER_DISCLOSURE is exactly the ADR-0021 verbatim sentence", () => {
    expect(EU_CROSS_BORDER_DISCLOSURE).toBe(
      "Your submission is processed on servers in the European Union.",
    );
  });

  it("the cross-border-transfer privacy section renders that exact sentence", () => {
    const section = PRIVACY_SECTIONS.find((s) => s.id === "cross-border-transfer");
    expect(section?.body).toBe(EU_CROSS_BORDER_DISCLOSURE);
  });

  it("the retention table mirrors all ADR-0021 data classes (9 rows, including two indefinite)", () => {
    expect(PRIVACY_RETENTION_CLASSES).toHaveLength(9);
    const indefinite = PRIVACY_RETENTION_CLASSES.filter((row) => row.retentionDays === null);
    expect(indefinite.map((row) => row.dataClass)).toEqual([
      "Published checks + evidence files",
      "Audit log",
    ]);
  });

  it("the limitation-of-liability Terms clause explicitly disclaims protecting against non-party (defamation) claims", () => {
    const clause = TERMS_SECTIONS.find((s) => s.id === "limitation-of-liability");
    expect(clause?.body).toContain("does NOT limit, and cannot limit, any claim by a third party");
  });

  it('no section anywhere claims the framework "protects us from defamation"', () => {
    const allTermsAndPrivacyCopy = JSON.stringify({ TERMS_SECTIONS, PRIVACY_SECTIONS });
    expect(allTermsAndPrivacyCopy.toLowerCase()).not.toContain("protects us from defamation");
  });

  it("every [ADVOCATE: ...] open question in Terms/Privacy is a visible marker, not resolved prose", () => {
    const allSections = [...TERMS_SECTIONS, ...PRIVACY_SECTIONS];
    const withMarkers = allSections.filter(
      (s): s is typeof s & { advocateMarker: string } => "advocateMarker" in s,
    );
    expect(withMarkers.length).toBeGreaterThan(0);
    for (const section of withMarkers) {
      expect(section.advocateMarker).toMatch(/^\[ADVOCATE:.*\]$/);
    }
  });
});
