// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { messages } from "@fact-checker-ke/i18n";
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

const { default: TermsPage } = await import("./page");
const { default: PrivacyPage } = await import("../privacy/page");

afterEach(() => {
  cleanup();
});

const BANNED_FRAMING_REFERENCES = ["CNN Facts First rating scale"];

/**
 * ADR-0033 AT-0033-5: regression guard against the corrected framing
 * (ADR-0033 Context — Africa-Check-style process + PesaCheck-style
 * headline, not a CNN Facts First rating scale). This scans the real
 * rendered Terms/Privacy pages AND the full EN/SW message catalogs —
 * the actual product copy surfaces, not just the `@fact-checker-ke/core`
 * data module (already covered by
 * `packages/core/src/__tests__/legal-caveat.test.ts`).
 */
describe("ADR-0033 AT-0033-5: no CNN Facts First rating-scale reference anywhere in product copy", () => {
  it("is absent from the rendered Terms page", async () => {
    const { container } = render(await TermsPage());
    for (const banned of BANNED_FRAMING_REFERENCES) {
      expect(container.textContent).not.toContain(banned);
    }
  });

  it("is absent from the rendered Privacy page", async () => {
    // PrivacyPage mounts a client component (TrainingConsentToggle) that
    // calls `useTranslations`, which needs a real `NextIntlClientProvider`
    // in the tree (unlike the server-only `getTranslations` mock above).
    const { container } = render(
      <IntlProviderHarness>{await PrivacyPage()}</IntlProviderHarness>,
    );
    for (const banned of BANNED_FRAMING_REFERENCES) {
      expect(container.textContent).not.toContain(banned);
    }
  });

  it("is absent from the EN and SW message catalogs", () => {
    const enBlob = JSON.stringify(messages.en);
    const swBlob = JSON.stringify(messages.sw);
    for (const banned of BANNED_FRAMING_REFERENCES) {
      expect(enBlob).not.toContain(banned);
      expect(swBlob).not.toContain(banned);
    }
  });
});
