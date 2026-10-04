// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TERMS_SECTIONS } from "@fact-checker-ke/core";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

const { default: TermsPage } = await import("./page");

afterEach(() => {
  cleanup();
});

/**
 * ADR-0033 §B / AT-0033-2 / AT-0033-6: the Terms page renders the
 * starter-draft clause set, explicitly labelled DRAFT, with every
 * `[ADVOCATE: ...]` open question visible (never silently resolved) and
 * no false "this protects us from a non-party's defamation claim" wording.
 */
describe("Terms & Conditions (draft) page content (ADR-0033)", () => {
  it("renders a visible DRAFT / pending-advocate-review badge", async () => {
    const jsx = await TermsPage();
    const { container } = render(jsx);
    const badge = container.querySelector(".legal-draft-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.toLowerCase()).toContain("draft");
  });

  it("renders the no-warranty, user-submission indemnity, and governing-law clauses", async () => {
    const jsx = await TermsPage();
    const { getByText } = render(jsx);
    const noWarranty = TERMS_SECTIONS.find((s) => s.id === "no-warranty");
    const indemnity = TERMS_SECTIONS.find((s) => s.id === "user-submitted-content");
    const governingLaw = TERMS_SECTIONS.find((s) => s.id === "governing-law");
    expect(noWarranty).toBeDefined();
    expect(indemnity).toBeDefined();
    expect(governingLaw).toBeDefined();
    expect(getByText(noWarranty!.body)).toBeTruthy();
    expect(getByText(indemnity!.body)).toBeTruthy();
    expect(getByText(governingLaw!.body)).toBeTruthy();
  });

  it("renders every [ADVOCATE: ...] marker from the data as visible text, not resolved prose", async () => {
    const jsx = await TermsPage();
    const { container } = render(jsx);
    const withMarkers = TERMS_SECTIONS.filter(
      (s): s is typeof s & { advocateMarker: string } => "advocateMarker" in s,
    );
    expect(withMarkers.length).toBeGreaterThan(0);
    for (const section of withMarkers) {
      expect(container.textContent).toContain(section.advocateMarker);
    }
  });

  it("the limitation-of-liability clause states it does not run to a non-party third-party claim", async () => {
    const jsx = await TermsPage();
    const { container } = render(jsx);
    expect(container.textContent).toContain(
      "does NOT limit, and cannot limit, any claim by a third party",
    );
  });

  it('never claims the Terms "protect us from defamation"', async () => {
    const jsx = await TermsPage();
    const { container } = render(jsx);
    expect(container.textContent?.toLowerCase()).not.toContain("protects us from defamation");
  });
});
