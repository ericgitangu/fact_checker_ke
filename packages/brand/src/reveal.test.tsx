import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reveal, Stagger } from "./reveal";

describe("Reveal / Stagger", () => {
  it("renders its children", () => {
    render(
      <Reveal>
        <p>hello</p>
      </Reveal>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("falls back to the revealed state when IntersectionObserver is unavailable (jsdom)", () => {
    const { container } = render(
      <Reveal>
        <p>x</p>
      </Reveal>,
    );
    expect(container.firstElementChild).toHaveClass("is-revealed");
  });

  it("wraps each stagger child and indexes it for the sequenced delay", () => {
    const { container } = render(
      <Stagger>
        <span>a</span>
        <span>b</span>
        <span>c</span>
      </Stagger>,
    );
    const items = container.querySelectorAll(".fck-stagger-item");
    expect(items).toHaveLength(3);
    expect((items[0] as HTMLElement).style.getPropertyValue("--fck-reveal-i")).toBe("0");
    expect((items[2] as HTMLElement).style.getPropertyValue("--fck-reveal-i")).toBe("2");
  });

  it("applies the chosen motion class", () => {
    const { container } = render(
      <Reveal motion="press">
        <p>x</p>
      </Reveal>,
    );
    expect(container.firstElementChild).toHaveClass("fck-reveal-press");
  });
});
