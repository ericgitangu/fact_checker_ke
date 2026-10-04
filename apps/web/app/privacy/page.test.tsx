// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  EU_CROSS_BORDER_DISCLOSURE,
  PRIVACY_RETENTION_CLASSES,
  PRIVACY_SECTIONS,
} from "@fact-checker-ke/core";
import { IntlProviderHarness } from "../../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

const localStorageStub = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
vi.stubGlobal("localStorage", localStorageStub);

const { default: PrivacyPage } = await import("./page");

afterEach(() => {
  cleanup();
});

/**
 * ADR-0033 §C / AT-0033-6 (ties to ADR-0021 AT-0021-5/AT-0021-6): the
 * Privacy page states the EU cross-border disclosure verbatim, mirrors
 * the ADR-0021 retention classes, surfaces the training-moat consent as
 * a severable control (AT-0033-3), and never claims to shield the
 * product from a non-party's defamation claim.
 */
describe("Privacy Policy (draft) page content (ADR-0033/ADR-0021)", () => {
  it("renders the EU cross-border processing disclosure verbatim", async () => {
    const jsx = render(<IntlProviderHarness>{await PrivacyPage()}</IntlProviderHarness>);
    expect(jsx.container.textContent).toContain(EU_CROSS_BORDER_DISCLOSURE);
  });

  it("renders a retention row for every ADR-0021 data class", async () => {
    const jsx = render(<IntlProviderHarness>{await PrivacyPage()}</IntlProviderHarness>);
    for (const row of PRIVACY_RETENTION_CLASSES) {
      expect(jsx.container.textContent).toContain(row.dataClass);
    }
    // "Indefinite" rendered for the two null-retention rows (published
    // checks + audit log), not a literal "null".
    expect(jsx.container.textContent).toContain("Indefinite");
    expect(jsx.container.textContent).not.toContain("null");
  });

  it("renders every [ADVOCATE: ...] marker as visible text", async () => {
    const jsx = render(<IntlProviderHarness>{await PrivacyPage()}</IntlProviderHarness>);
    const withMarkers = PRIVACY_SECTIONS.filter(
      (s): s is typeof s & { advocateMarker: string } => "advocateMarker" in s,
    );
    expect(withMarkers.length).toBeGreaterThan(0);
    for (const section of withMarkers) {
      expect(jsx.container.textContent).toContain(section.advocateMarker);
    }
  });

  it("renders the training-moat consent as an unchecked, opt-in toggle, separate from any submission flow", async () => {
    const jsx = render(<IntlProviderHarness>{await PrivacyPage()}</IntlProviderHarness>);
    const checkbox = jsx.container.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    // Severability: no <form> wraps this control, and nothing here is a
    // submit-a-claim affordance.
    expect(jsx.container.querySelector("form")).toBeNull();
  });

  it('never claims the Privacy Policy "protects us from defamation"', async () => {
    const jsx = render(<IntlProviderHarness>{await PrivacyPage()}</IntlProviderHarness>);
    expect(jsx.container.textContent?.toLowerCase()).not.toContain("protects us from defamation");
  });
});
