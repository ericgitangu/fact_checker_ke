// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render, screen, waitFor } from "@testing-library/react";
import { expectNoAxeViolations, pageAxeOptions } from "../../test/axe-config";
import { IntlProviderHarness } from "../../test/render-with-intl";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: EditorPage } = await import("./page");
const { AppShellHarness } = await import("../../test/app-shell-harness");
// The REAL BFF route handler (not a reimplementation): with no reachable
// API_BASE_URL in this test process it falls through to the real
// `fixtures/editor-drafts.ts` mock data, same as it does in dev today.
const { GET } = await import("../api/editor/drafts/route");

describe("Editor page a11y (AT-0028-2)", () => {
  beforeEach(() => {
    // EditorDraftsPanel fetches a relative URL on mount; jsdom has no HTTP
    // server to resolve it against, so this bridges `fetch("/api/editor/
    // drafts")` straight to the real Next route handler's `GET()` export
    // -- the actual fixture-backed response body, not a hand-written mock
    // of what the API "should" return.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/editor/drafts")) return GET();
        throw new Error(`Unhandled fetch in test: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drafts queue (loaded via the real BFF route + mock fixture): zero WCAG 2.2 AA violations", async () => {
    const pageJsx = await EditorPage();
    const page = await AppShellHarness({ children: pageJsx });
    const { container } = render(<IntlProviderHarness>{page}</IntlProviderHarness>);

    // Wait for EditorDraftsPanel's real fetch -> real route handler round
    // trip to resolve and render the actual mock draft rows, not the
    // transient loading state.
    await waitFor(() => expect(screen.getByText(/Pending drafts/i)).toBeInTheDocument());

    const results = await axe(container, pageAxeOptions);
    expectNoAxeViolations(results);
  });
});
