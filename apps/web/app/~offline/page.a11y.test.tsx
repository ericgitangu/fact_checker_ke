// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render, screen } from "@testing-library/react";
import { componentAxeOptions, expectNoAxeViolations } from "../../test/axe-config";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

const { default: OfflinePage } = await import("./page");

/**
 * Offline-fallback page (ADR-0028 "offline/SW cache policy"): what the
 * real service worker (app/sw.ts, via the shared `./sw-caching-policy`
 * predicates covered by app/sw-offline.test.ts) serves for a failed
 * document-request navigation. This renders the REAL page component and
 * its REAL, catalog-sourced copy -- it is never a frozen/stale cached
 * check or tracker advisory, just this honest "you're offline" state.
 */
describe("Offline fallback page a11y + content (AT-0028-2 / AT-0028-4/5 neighbourhood)", () => {
  it("renders the real offline-state copy with zero WCAG 2.2 AA violations", async () => {
    const jsx = await OfflinePage();
    const { container } = render(jsx);

    expect(screen.getByRole("heading", { name: /you're offline/i })).toBeInTheDocument();
    expect(screen.getByText(/couldn't reach the network/i)).toBeInTheDocument();

    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });
});
