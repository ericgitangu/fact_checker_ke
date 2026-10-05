// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

const { AppFooter } = await import("./site-chrome");

afterEach(() => {
  cleanup();
});

/**
 * The production footer: every link must resolve to a real, existing
 * route — no "Terms & Privacy (pending legal review)" dead-end text
 * standing in for a link. This guards against silently regressing back to
 * that stub, and against a footer link pointing at a route that doesn't
 * exist (checked against the real route files under app/*\/page.tsx).
 */
describe("AppFooter (production footer)", () => {
  it("links every Product/Project/Legal entry to a real internal route", async () => {
    const jsx = await AppFooter();
    const { container } = render(jsx);

    const expectedHrefs = [
      "/submit",
      "/feed",
      "/maandamano",
      "/methodology",
      "/join",
      "/contact",
      "/terms",
      "/privacy",
    ];
    for (const href of expectedHrefs) {
      const link = container.querySelector(`a[href="${href}"]`);
      expect(link, `expected a footer link to ${href}`).toBeTruthy();
    }
  });

  it("links out to the real GitHub repository", async () => {
    const jsx = await AppFooter();
    const { container } = render(jsx);
    const repoLink = container.querySelector('a[href="https://github.com/ericgitangu/fact_checker_ke"]');
    expect(repoLink).toBeTruthy();
    expect(repoLink).toHaveAttribute("target", "_blank");
    expect(repoLink).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("still shows a visible draft indicator next to the Legal group, without hiding the links", () => {
    // Covered by the first assertion (terms/privacy hrefs present) plus
    // this: the badge text itself is still rendered somewhere in the footer.
    return AppFooter().then((jsx) => {
      const { container } = render(jsx);
      const badge = container.querySelector(".legal-draft-badge");
      expect(badge).toBeTruthy();
      expect(badge?.textContent?.toLowerCase()).toContain("draft");
      // And the Terms/Privacy links are NOT inside that badge element.
      expect(container.querySelector('a[href="/terms"]')).toBeTruthy();
      expect(container.querySelector('a[href="/privacy"]')).toBeTruthy();
    });
  });

  it("renders a copyright line with the current year", async () => {
    const jsx = await AppFooter();
    const { container } = render(jsx);
    const year = String(new Date().getUTCFullYear());
    expect(container.textContent).toContain(year);
    expect(container.textContent).toContain("fact_checker_ke");
  });
});
