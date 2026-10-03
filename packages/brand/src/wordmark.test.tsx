import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wordmark } from "./wordmark";

describe("Wordmark", () => {
  it("renders exactly one fact_checker_ke text node, the mark, and the waving flag by default", () => {
    render(<Wordmark />);
    expect(screen.getByText("fact_checker_ke")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "fact_checker_ke" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Kenya" })).toBeInTheDocument();
  });

  it("omits the text node and flag when showText is false", () => {
    render(<Wordmark showText={false} />);
    expect(screen.queryByText("fact_checker_ke")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Kenya" })).not.toBeInTheDocument();
    // The mark itself still renders.
    expect(screen.getByRole("img", { name: "fact_checker_ke" })).toBeInTheDocument();
  });

  it("marks the icon-only mark as decorative (aria-hidden) when decorative+!showText", () => {
    const { container } = render(<Wordmark showText={false} decorative />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("omits the waving flag entirely for variant=mono", () => {
    render(<Wordmark variant="mono" />);
    expect(screen.queryByRole("img", { name: "Kenya" })).not.toBeInTheDocument();
  });

  it("applies size/variant classes", () => {
    const { container } = render(<Wordmark size="lg" variant="dark" />);
    const root = container.firstElementChild;
    expect(root).toHaveClass("fck-wordmark-lg");
    expect(root).toHaveClass("fck-wordmark-dark");
  });
});
