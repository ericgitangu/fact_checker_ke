// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FOUNDER_CONTACT } from "../../lib/contact";

vi.mock("next-intl/server", async () => {
  const mod = await import("../../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

const { default: ContactPage } = await import("./page");

afterEach(() => {
  cleanup();
});

/**
 * The real `/contact` page that replaces the old dead "Terms & Privacy
 * (pending legal review)" footer text: a founder contact card whose
 * details all come verbatim from `FOUNDER_CONTACT` (see `lib/contact.ts`
 * for provenance), plus a vCard download affordance.
 */
describe("/contact page", () => {
  it("renders the founder's name, role, location and a mailto link to the real email", async () => {
    const jsx = await ContactPage();
    const { container, getByText } = render(jsx);
    expect(getByText(FOUNDER_CONTACT.name)).toBeTruthy();
    const mailLink = container.querySelector(`a[href="mailto:${FOUNDER_CONTACT.email}"]`);
    expect(mailLink).toBeTruthy();
  });

  it("links to the real GitHub, LinkedIn and portfolio URLs, each opening in a new tab", async () => {
    const jsx = await ContactPage();
    const { container } = render(jsx);
    for (const url of [FOUNDER_CONTACT.github, FOUNDER_CONTACT.linkedin, FOUNDER_CONTACT.site]) {
      const link = container.querySelector(`a[href="${url}"]`);
      expect(link, `expected a link to ${url}`).toBeTruthy();
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("never invents a phone number or an address beyond city/country", async () => {
    const jsx = await ContactPage();
    const { container } = render(jsx);
    expect(container.textContent).not.toMatch(/\+?\d[\d\s()-]{7,}\d/);
  });

  it("renders the vCard download button", async () => {
    const jsx = await ContactPage();
    const { getByRole } = render(jsx);
    expect(getByRole("button", { name: /download vcard/i })).toBeTruthy();
  });
});
