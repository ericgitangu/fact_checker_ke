import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

describe("App (marketing site)", () => {
  it("renders the hero and GitHub CTA", () => {
    render(<App />);
    expect(screen.getByText("fact_checker_ke")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /view the code on github/i });
    expect(cta).toHaveAttribute("href", "https://github.com/ericgitangu");
  });

  it("waitlist form is a client-side stub: it never calls fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<App />);
    const input = screen.getByPlaceholderText("you@example.com");
    fireEvent.change(input, { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));

    expect(screen.getByText(/you're on the list/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
