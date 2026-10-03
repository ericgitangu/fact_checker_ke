// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render } from "@testing-library/react";
import { expectNoAxeViolations, pageAxeOptions } from "../../test/axe-config";
import { IntlProviderHarness } from "../../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

// AppHeader (test/app-shell-harness) renders the real LocaleSwitcher, a
// client component whose `useRouter()` call throws outside the Next App
// Router runtime -- see apps/web/app/page.a11y.test.tsx for the same note.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: MaandamanoPage } = await import("./page");
const { AppShellHarness } = await import("../../test/app-shell-harness");

afterEach(() => {
  delete process.env.MAANDAMANO_FROZEN;
});

describe("Maandamano tracker page a11y (AT-0028-2)", () => {
  it("live advisories view: zero WCAG 2.2 AA violations", async () => {
    const pageJsx = await MaandamanoPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });

  it("frozen/kill-switch view: zero WCAG 2.2 AA violations", async () => {
    process.env.MAANDAMANO_FROZEN = "true";
    const pageJsx = await MaandamanoPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
