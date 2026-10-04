// @vitest-environment jsdom
import { describe, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render } from "@testing-library/react";
import { expectNoAxeViolations, pageAxeOptions } from "../../test/axe-config";
import { IntlProviderHarness } from "../../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The privacy page mounts a client component (TrainingConsentToggle) that
// reads localStorage -- stub it the same way device-token.ts's own tests
// would, so the a11y pass exercises the real control, not a mock DOM.
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
const { AppShellHarness } = await import("../../test/app-shell-harness");

describe("Privacy Policy (draft) page a11y (ADR-0033/ADR-0021)", () => {
  it("renders the real privacy page (incl. header/footer chrome) with zero WCAG 2.2 AA violations", async () => {
    const pageJsx = await PrivacyPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
