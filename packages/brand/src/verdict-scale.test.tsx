import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictScale } from "./verdict-scale";

describe("VerdictScale", () => {
  it("renders exactly the six verdicts, in supported→not, then off-axis order", () => {
    render(<VerdictScale />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(6);
    const names = items.map((li) => li.querySelector(".fck-scale-name")?.textContent);
    expect(names).toEqual([
      "True",
      "Mostly true",
      "Misleading",
      "False",
      "Unproven",
      "Not checkable",
    ]);
  });

  it("gives each verdict a one-line evidentiary description, not an opinion about a person", () => {
    render(<VerdictScale />);
    expect(screen.getByText(/Backed by credible evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/not a fact/i)).toBeInTheDocument();
  });

  it("exposes the scale as a single labelled list for assistive tech", () => {
    render(<VerdictScale ariaLabel="Custom scale label" />);
    expect(screen.getByRole("list", { name: "Custom scale label" })).toBeInTheDocument();
  });

  it("marks the seals decorative so the glyphs aren't announced as content", () => {
    const { container } = render(<VerdictScale />);
    const seals = container.querySelectorAll(".fck-scale-seal");
    expect(seals).toHaveLength(6);
    seals.forEach((seal) => expect(seal).toHaveAttribute("aria-hidden", "true"));
  });

  it("falls back to the finished (revealed) state when IntersectionObserver is unavailable (jsdom)", () => {
    const { container } = render(<VerdictScale />);
    expect(container.firstElementChild).toHaveClass("is-revealed");
  });

  it("applies the dark variant class", () => {
    const { container } = render(<VerdictScale variant="dark" />);
    expect(container.firstElementChild).toHaveClass("fck-scale-dark");
  });
});
