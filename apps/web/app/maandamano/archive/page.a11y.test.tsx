// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render } from "@testing-library/react";
import { expectNoAxeViolations, pageAxeOptions } from "../../../test/axe-config";
import { IntlProviderHarness } from "../../../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/maandamano/archive",
}));

const { default: ArchivePage } = await import("./page");
const { AppShellHarness } = await import("../../../test/app-shell-harness");

function mockArchiveFetch(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * ADR-0035 (AT-0035-5): the archive view — concluded advisories with a
 * status-history timeline and embed/source links — stays WCAG 2.2 AA clean,
 * including the frozen/kill-switch state (same server-side gate as the live
 * list).
 */
describe("Maandamano archive page a11y (ADR-0035)", () => {
  it("concluded advisories with history + a media link: zero WCAG 2.2 AA violations", async () => {
    mockArchiveFetch({
      frozen: false,
      archived: [
        {
          id: "e1a1f1a0-0000-4000-8000-000000000001",
          title: "Concluded march along Moi Avenue",
          area: "Nairobi Central Ward",
          county: "Nairobi",
          status: "ended",
          date: "2026-10-10",
          summary: "A march that has since concluded peacefully.",
          sourceUrl: "https://example.com/advisory/archived/1",
          updatedAt: new Date().toISOString(),
          media: [
            {
              id: "bbbbbbb0-0000-4000-8000-000000000001",
              platform: "youtube",
              embedUrl: "https://www.youtube.com/embed/ended-clip",
              caption: null,
              observedAt: new Date().toISOString(),
              misinfoStatus: "clear",
              misinfoNote: null,
            },
          ],
          statusHistory: [
            { status: "ongoing", note: null, occurredAt: new Date(Date.now() - 3600_000).toISOString() },
            { status: "ended", note: "concluded peacefully", occurredAt: new Date().toISOString() },
          ],
        },
      ],
    });

    const pageJsx = await ArchivePage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });

  it("frozen/kill-switch view: zero WCAG 2.2 AA violations", async () => {
    mockArchiveFetch({ frozen: true, archived: [] });

    const pageJsx = await ArchivePage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
