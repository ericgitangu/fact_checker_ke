// @vitest-environment jsdom
import { describe, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render } from "@testing-library/react";
import { expectNoAxeViolations, pageAxeOptions } from "../test/axe-config";
import { IntlProviderHarness } from "../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

// next/navigation's useRouter is used by the LocaleSwitcher in the header
// chrome (and, on /submit, by SubmitForm); outside the Next App Router
// runtime it throws ("invariant expected app router to be mounted"), so
// it's stubbed here the same way Next's own app-router test harness would
// provide it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

const { default: Home } = await import("./page");
const { AppShellHarness } = await import("../test/app-shell-harness");

// `/` is the consolidated marketing landing (ADR-0010/0015 amendments); the
// smart-input submit screen moved to `/submit`. This pass covers the
// landing + the shared header/footer chrome (incl. the new ThemeToggle).
describe("Home (landing) page a11y (AT-0028-2)", () => {
  it("renders the real landing page (incl. header/footer chrome) with zero WCAG 2.2 AA violations", async () => {
    const homeJsx = await Home();
    const page = await AppShellHarness({ children: homeJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
