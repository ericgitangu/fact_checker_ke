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
  usePathname: () => "/",
}));

const { default: MaandamanoPage } = await import("./page");
const { AppShellHarness } = await import("../../test/app-shell-harness");

/**
 * ADR-0007 kill-switch: the page now gets `frozen`/`demonstrations` from
 * `GET /v1/maandamano` (via `ApiClient.getMaandamano`), not a
 * `MAANDAMANO_FROZEN` env var or a bundled fixture. Stubbing `fetch`
 * exercises the real page -> ApiClient -> fetch path end to end, with
 * only the network boundary faked.
 */
function mockMaandamanoFetch(body: unknown): void {
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

describe("Maandamano tracker page a11y (AT-0028-2)", () => {
  it("live advisories view: zero WCAG 2.2 AA violations", async () => {
    mockMaandamanoFetch({
      frozen: false,
      demonstrations: [
        {
          id: "d1a1f1a0-0000-4000-8000-000000000001",
          title: "Planned march along Moi Avenue",
          area: "Nairobi Central Ward",
          county: "Nairobi",
          status: "announced",
          date: "2026-10-10",
          summary:
            "Organisers announced a planned march; the county has not yet confirmed a route or permit status.",
          sourceUrl: "https://example.com/advisory/1",
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    const pageJsx = await MaandamanoPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });

  it("frozen/kill-switch view: zero WCAG 2.2 AA violations", async () => {
    mockMaandamanoFetch({ frozen: true, demonstrations: [] });

    const pageJsx = await MaandamanoPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);
    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
