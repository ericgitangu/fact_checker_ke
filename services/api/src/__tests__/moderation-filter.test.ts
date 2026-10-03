import { describe, expect, it } from "vitest";
import { FakeObjectionableContentScorer } from "../lib/moderation-filter.js";

/** AT-0024-1: a comment containing a phone-number pattern or slur never becomes publicly visible without editor release. */
describe("FakeObjectionableContentScorer (ADR-0024 §2, no billable/external call)", () => {
  const scorer = new FakeObjectionableContentScorer();

  it("flags a Kenyan phone-number pattern", async () => {
    const result = await scorer.score("call me on 0712345678 for details");
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain("phone_number_pattern");
  });

  it("flags a slur keyword", async () => {
    const result = await scorer.score("that contains slur-placeholder-one in it");
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain("slur_keyword");
  });

  it("flags a spam-link domain", async () => {
    const result = await scorer.score("check this out http://free-prize.xyz/claim");
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain("spam_link_pattern");
  });

  it("does not flag an ordinary comment", async () => {
    const result = await scorer.score("I think this fact-check was thorough and fair.");
    expect(result.flagged).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("never makes a network call (resolves synchronously-derived data only)", async () => {
    // No fetch/http mock is set up anywhere in this test file; if the
    // scorer tried a real network call in a sandboxed test env it would
    // throw or hang, not silently pass -- this is the closest a unit
    // test gets to proving "no billable external call" empirically.
    const result = await scorer.score("plain text, nothing flagged");
    expect(result).toEqual({ flagged: false, reasons: [] });
  });
});
