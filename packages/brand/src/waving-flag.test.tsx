import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { WavingFlag } from "./waving-flag";

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("WavingFlag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an accessible svg labelled Kenya by default", () => {
    const { getByRole } = render(<WavingFlag />);
    expect(getByRole("img", { name: "Kenya" })).toBeInTheDocument();
  });

  it("applies the given className to the svg element", () => {
    const { getByRole } = render(<WavingFlag className="fck-wordmark-flag" />);
    expect(getByRole("img", { name: "Kenya" })).toHaveClass("fck-wordmark-flag");
  });

  it("sways the cloth group by default (motion not reduced)", () => {
    mockMatchMedia(false);
    const { container } = render(<WavingFlag />);
    expect(container.querySelector(".fck-flag-cloth-sway")).not.toBeNull();
    expect(container.querySelector(".fck-flag-cloth-still")).toBeNull();
  });

  it("renders a still, gently-furled cloth group under prefers-reduced-motion", () => {
    mockMatchMedia(true);
    const { container } = render(<WavingFlag />);
    expect(container.querySelector(".fck-flag-cloth-still")).not.toBeNull();
    expect(container.querySelector(".fck-flag-cloth-sway")).toBeNull();
    // The turbulence filter's <animate> is also skipped under reduced motion.
    expect(container.querySelector("feTurbulence > animate")).toBeNull();
  });

  it("doesn't throw where window.matchMedia isn't a function (jsdom/SSR gap)", () => {
    const original = window.matchMedia;
    // @ts-expect-error -- simulating an environment without matchMedia at all.
    delete window.matchMedia;
    expect(() => render(<WavingFlag />)).not.toThrow();
    window.matchMedia = original;
  });
});
