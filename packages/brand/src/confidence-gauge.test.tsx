import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceGauge } from "./confidence-gauge";

describe("ConfidenceGauge", () => {
  it("is a meter with the real value exposed to assistive tech", () => {
    render(<ConfidenceGauge value={0.88} label="Confidence weight" />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "88");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-label", "Confidence weight: 88%");
  });

  it("renders the percentage as a redundant visual readout, rounded", () => {
    const { container } = render(<ConfidenceGauge value={0.776} label="Confidence" />);
    expect(container.querySelector(".fck-gauge-value")?.textContent).toBe("78");
  });

  it("clamps out-of-range values defensively", () => {
    const { rerender } = render(<ConfidenceGauge value={1.9} label="c" />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    rerender(<ConfidenceGauge value={-0.5} label="c" />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("treats a non-finite value as zero rather than crashing", () => {
    render(<ConfidenceGauge value={Number.NaN} label="c" />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("applies variant and size classes", () => {
    const { container } = render(
      <ConfidenceGauge value={0.5} label="c" variant="dark" size="sm" />,
    );
    expect(container.firstElementChild).toHaveClass("fck-gauge-dark");
    expect(container.firstElementChild).toHaveClass("fck-gauge-sm");
  });
});
