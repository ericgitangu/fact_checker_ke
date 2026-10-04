import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TwoEngineFlow } from "./two-engine-flow";

describe("TwoEngineFlow", () => {
  it("leads with the fetch engine as primary, submit as secondary", () => {
    render(<TwoEngineFlow />);
    const entries = screen.getAllByRole("listitem").slice(0, 2);
    expect(entries[0]).toHaveTextContent("We fetch");
    expect(entries[0]).toHaveTextContent("Primary engine");
    expect(entries[1]).toHaveTextContent("You submit");
    expect(entries[1]).toHaveTextContent("Secondary engine");
  });

  it("does not overclaim autonomous TikTok monitoring", () => {
    render(<TwoEngineFlow />);
    const fetchNode = screen.getByText("We fetch").closest("li");
    expect(fetchNode).toHaveTextContent(/TikTok is embed-only/i);
  });

  it("renders the shared pipeline as an ordered list, extract through audit", () => {
    render(<TwoEngineFlow />);
    const ol = screen.getByRole("list", { name: /what happens once a claim is in/i });
    const steps = Array.from(ol.querySelectorAll("li")).map((li) => li.querySelector("h3")?.textContent);
    expect(steps).toEqual(["Extract", "Ground", "Assess", "Publish", "Audit"]);
  });

  it("falls back to the finished (visible) state when IntersectionObserver is unavailable, e.g. under jsdom", () => {
    const { container } = render(<TwoEngineFlow />);
    expect(container.firstElementChild).toHaveClass("fck-flow-visible");
  });

  it("applies the dark variant class", () => {
    const { container } = render(<TwoEngineFlow variant="dark" />);
    expect(container.firstElementChild).toHaveClass("fck-flow-dark");
  });

  it("exposes a single accessible group label for the whole process", () => {
    render(<TwoEngineFlow ariaLabel="Custom label" />);
    expect(screen.getByRole("group", { name: "Custom label" })).toBeInTheDocument();
  });
});
