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

// next/navigation's useRouter is used by SubmitForm and LocaleSwitcher;
// outside the Next App Router runtime it throws ("invariant expected app
// router to be mounted"), so it's stubbed here the same way Next's own
// app-router test harness would provide it -- SubmitForm's actual
// navigation call (`router.push` on submit success) is exercised by this
// app's other submit-flow tests, not by this a11y pass.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: Home } = await import("./page");
const { AppShellHarness } = await import("../test/app-shell-harness");

describe("Home / submit-form page a11y (AT-0028-2)", () => {
  it("renders the real home+submit-form page (incl. header/footer chrome) with zero WCAG 2.2 AA violations", async () => {
    const homeJsx = await Home();
    const page = await AppShellHarness({ children: homeJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
