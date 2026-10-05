// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { IntlProviderHarness } from "../../test/render-with-intl";
import { GITHUB_REPO_URL } from "../../lib/site";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

const { default: JoinPage } = await import("./page");

afterEach(() => {
  cleanup();
});

/**
 * `/join` ("how to join the movement"): three concrete ways in (GitHub,
 * submit a claim, partner/sponsor) plus an honest forward-looking note
 * that the project may move to a gated/private-access model as
 * monetization matures (ADR-0012) — the note must be visible, not buried,
 * and it must not read as a flat rejection ("register interest" CTA
 * stays present right under it).
 */
describe("/join page", () => {
  it("links out to the real GitHub repo and in to /submit", async () => {
    const jsx = await JoinPage();
    // WaitlistForm is a client component using useTranslations, which
    // needs a real NextIntlClientProvider in the tree.
    const { container } = render(<IntlProviderHarness>{jsx}</IntlProviderHarness>);
    const repoLink = container.querySelector(`a[href="${GITHUB_REPO_URL}"]`);
    expect(repoLink).toBeTruthy();
    expect(repoLink).toHaveAttribute("target", "_blank");
    expect(container.querySelector('a[href="/submit"]')).toBeTruthy();
  });

  it("renders the forward-looking gating note, honestly, next to a still-open registration CTA", async () => {
    const jsx = await JoinPage();
    const { container, getByText } = render(<IntlProviderHarness>{jsx}</IntlProviderHarness>);
    expect(container.textContent?.toLowerCase()).toContain("open");
    // The registration form (WaitlistForm) is still present and enabled.
    expect(getByText(/which best describes you/i)).toBeTruthy();
  });

  it("renders the waitlist/registration form for early contributor interest", async () => {
    const jsx = await JoinPage();
    const { getByRole } = render(<IntlProviderHarness>{jsx}</IntlProviderHarness>);
    expect(getByRole("button", { name: /join/i })).toBeTruthy();
  });
});
