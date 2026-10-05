// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render, screen } from "@testing-library/react";
import { expectNoAxeViolations, pageAxeOptions } from "../../test/axe-config";
import { IntlProviderHarness } from "../../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

// AppShellHarness renders the real header, whose LocaleSwitcher calls
// next/navigation's useRouter — stubbed here so the shell mounts in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

const { default: EditorPage } = await import("./page");
const { AppShellHarness } = await import("../../test/app-shell-harness");

describe("Editor page a11y (AT-0028-2)", () => {
  // `/editor` is gated: with no real editor-session auth wired yet it must
  // NOT render a pretend-logged-in editor against mock drafts. It renders
  // an honest "sign-in required" state instead (see page.tsx). This test
  // exercises the REAL page component and asserts both that gated state
  // and its accessibility — there is no fetch/fixture round trip to mock
  // because the gated page never mounts the drafts panel.
  it("renders the honest sign-in-required state (not the mock editor), zero WCAG 2.2 AA violations", async () => {
    const pageJsx = await EditorPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);

    // The gated state is present and the mock moderation queue is NOT.
    expect(screen.getByText(/Sign-in required/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pending drafts/i)).not.toBeInTheDocument();

    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
