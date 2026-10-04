// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { STANDING_CAVEAT_SHORT, TIER_C_INLINE_CAVEAT } from "@fact-checker-ke/core";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

// Imported AFTER the mock so LegalCaveat picks up the mocked
// `next-intl/server` -- this is the real exported component, not a
// reimplementation of its markup.
const { LegalCaveat } = await import("./legal-caveat");

/**
 * ADR-0033 AT-0033-1: the standing caveat renders on every published
 * check, driven by the single `STANDING_CAVEAT_SHORT` source string
 * (`@fact-checker-ke/core`) rather than a re-typed copy here.
 */
describe("LegalCaveat (ADR-0033 AT-0033-1/AT-0033-4)", () => {
  it("renders the exact standing-caveat heading and body from the one source string", async () => {
    const jsx = await LegalCaveat({ riskTier: "A" });
    const { getByText } = render(jsx);
    expect(getByText(STANDING_CAVEAT_SHORT.heading)).toBeTruthy();
    expect(getByText(STANDING_CAVEAT_SHORT.body)).toBeTruthy();
  });

  it("always renders a visible draft/pending-advocate-review marker (AT-0033-2)", async () => {
    const jsx = await LegalCaveat({ riskTier: "A" });
    const { container } = render(jsx);
    const badge = container.querySelector(".legal-draft-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toMatch(/draft/i);
  });

  it("links to the Terms & Privacy page", async () => {
    const jsx = await LegalCaveat({ riskTier: "A" });
    const { container } = render(jsx);
    const link = container.querySelector('a[href="/terms"]');
    expect(link).toBeTruthy();
  });

  it("does NOT render the Tier-C inline open-question notice for a Tier A check", async () => {
    const jsx = await LegalCaveat({ riskTier: "A" });
    const { queryByText } = render(jsx);
    expect(queryByText(TIER_C_INLINE_CAVEAT.body)).toBeNull();
  });

  it("renders the Tier-C inline claim-attributed open-question framing in addition to the standing caveat", async () => {
    const jsx = await LegalCaveat({ riskTier: "C" });
    const { getByText } = render(jsx);
    expect(getByText(STANDING_CAVEAT_SHORT.heading)).toBeTruthy();
    expect(getByText(TIER_C_INLINE_CAVEAT.body, { exact: false })).toBeTruthy();
  });

  it("never renders a banned person-indicting phrase, for any risk tier", async () => {
    for (const riskTier of ["A", "B", "C"] as const) {
      const jsx = await LegalCaveat({ riskTier });
      const { container } = render(jsx);
      const text = container.textContent?.toLowerCase() ?? "";
      expect(text).not.toContain("lied");
      expect(text).not.toContain("is a liar");
    }
  });

  it("never references the corrected-away CNN Facts First rating scale", async () => {
    const jsx = await LegalCaveat({ riskTier: "C" });
    const { container } = render(jsx);
    expect(container.textContent ?? "").not.toContain("CNN Facts First rating scale");
  });
});
