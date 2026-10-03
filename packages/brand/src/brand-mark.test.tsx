import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BrandMark } from "./brand-mark";

describe("BrandMark", () => {
  it("renders an accessible svg labelled fact_checker_ke by default", () => {
    const { getByRole } = render(<BrandMark />);
    const svg = getByRole("img", { name: "fact_checker_ke" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("uses a gradient fill (url(#...)) by default and currentColor for tone=mono", () => {
    const gradient = render(<BrandMark />);
    const gradientRect = gradient.container.querySelector("rect[fill^='url(#']");
    expect(gradientRect).not.toBeNull();

    const mono = render(<BrandMark tone="mono" />);
    const monoRect = mono.container.querySelector("rect[fill='currentColor']");
    expect(monoRect).not.toBeNull();
  });

  it("respects a custom title and size", () => {
    const { getByRole } = render(<BrandMark title="Custom label" size={48} />);
    const svg = getByRole("img", { name: "Custom label" });
    expect(svg).toHaveAttribute("width", "48");
    expect(svg).toHaveAttribute("height", "48");
  });
});
