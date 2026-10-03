import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SunIcon, MoonIcon, ExternalLinkIcon, ShieldCheckIcon } from "./icons";

describe("icons", () => {
  it.each([
    ["SunIcon", SunIcon],
    ["MoonIcon", MoonIcon],
    ["ExternalLinkIcon", ExternalLinkIcon],
    ["ShieldCheckIcon", ShieldCheckIcon],
  ] as const)("%s renders a decorative (aria-hidden) svg with currentColor stroke", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("stroke", "currentColor");
  });

  it("respects a custom size", () => {
    const { container } = render(<SunIcon size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });
});
