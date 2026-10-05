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
  usePathname: () => "/",
}));

const { default: JoinPage } = await import("./page");
const { AppShellHarness } = await import("../../test/app-shell-harness");

describe("/join page a11y", () => {
  it("renders the real join page (incl. header/footer chrome and the waitlist form) with zero WCAG 2.2 AA violations", async () => {
    const pageJsx = await JoinPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
