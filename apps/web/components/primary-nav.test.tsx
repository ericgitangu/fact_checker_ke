// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimaryNav } from "./primary-nav";

afterEach(() => {
  cleanup();
});

/**
 * The responsive header disclosure (the mobile-overflow fix): on mobile the
 * primary nav collapses behind a hamburger toggle so the ~350px link row
 * stops pushing every page past the 375px viewport. These guard the
 * keyboard/ARIA contract of that toggle — the visual collapse itself is CSS
 * (verified empirically at 375px across every route), not unit-testable
 * here, but the disclosure semantics are.
 */
describe("PrimaryNav disclosure (mobile-overflow fix)", () => {
  it("exposes a labelled toggle wired to the menu, collapsed by default", () => {
    render(
      <PrimaryNav menuLabel="Menu">
        <a href="/feed">Feed</a>
      </PrimaryNav>,
    );
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const menuId = toggle.getAttribute("aria-controls");
    expect(menuId).toBeTruthy();
    // aria-controls must point at the real menu container.
    expect(document.getElementById(menuId as string)).not.toBeNull();
  });

  it("toggles aria-expanded open and closed on activation", async () => {
    const user = userEvent.setup();
    render(
      <PrimaryNav menuLabel="Menu">
        <a href="/feed">Feed</a>
      </PrimaryNav>,
    );
    const toggle = screen.getByRole("button", { name: "Menu" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <PrimaryNav menuLabel="Menu">
        <a href="/feed">Feed</a>
      </PrimaryNav>,
    );
    const toggle = screen.getByRole("button", { name: "Menu" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
