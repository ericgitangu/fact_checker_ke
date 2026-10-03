import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WavingFlag } from "./waving-flag";

describe("WavingFlag", () => {
  it("renders an accessible svg labelled Kenya by default", () => {
    const { getByRole } = render(<WavingFlag />);
    expect(getByRole("img", { name: "Kenya" })).toBeInTheDocument();
  });

  it("applies the given className to the svg element", () => {
    const { getByRole } = render(<WavingFlag className="fck-wordmark-flag" />);
    expect(getByRole("img", { name: "Kenya" })).toHaveClass("fck-wordmark-flag");
  });
});
