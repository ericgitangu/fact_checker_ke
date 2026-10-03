import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fillAndSubmit(email: string): Promise<void> {
  const input = screen.getByLabelText(/email address/i);
  fireEvent.change(input, { target: { value: email } });
  // The submit handler is async (it awaits `fetch`); wrapping the click in
  // an async `act` lets React flush the state updates that happen after
  // that await, instead of leaking them past the test's assertions.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
  });
}

describe("App (marketing site)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders the wordmark, a GitHub link, and methodology links built from VITE_WEB_URL", () => {
    render(<App />);
    expect(screen.getByText("fact_checker_ke")).toBeInTheDocument();

    // GitHub is linked (nav + footer both point at the owner's profile).
    const githubLinks = screen
      .getAllByRole("link", { name: /github/i })
      .filter((a) => a.getAttribute("href") === "https://github.com/ericgitangu");
    expect(githubLinks.length).toBeGreaterThan(0);

    // Every methodology link resolves to VITE_WEB_URL/methodology.
    const methodologyLinks = screen.getAllByRole("link", { name: /methodology/i });
    expect(methodologyLinks.length).toBeGreaterThan(0);
    for (const link of methodologyLinks) {
      expect(link).toHaveAttribute("href", "http://localhost:3000/methodology");
    }
  });

  it("idle: shows the form with no status message", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /^join$/i })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("invalid: a malformed email is rejected client-side without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<App />);

    await fillAndSubmit("not-an-email");

    expect(await screen.findByRole("status")).toHaveTextContent(/valid email/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submitting: disables the form while the request is in flight", async () => {
    let resolveFetch!: (res: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    render(<App />);

    await fillAndSubmit("jane@example.com");

    expect(screen.getByRole("button", { name: /joining/i })).toBeDisabled();

    resolveFetch(jsonResponse(201, { status: "joined" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/thanks/i));
  });

  it("joined: a 201 response shows the joined confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, { status: "joined" }));
    render(<App />);

    await fillAndSubmit("jane@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(/you're on the waitlist/i);
    expect(screen.getByRole("button")).toHaveTextContent(/you're on the list/i);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe("http://localhost:8080/v1/waitlist");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "jane@example.com",
      source: "site",
    });
  });

  it("already_joined: a 200 response says the email is already on the list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, { status: "already_joined" }),
    );
    render(<App />);

    await fillAndSubmit("jane@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(/already on the waitlist/i);
  });

  it("rate-limited: a 429 response tells the user to retry later", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(429, {}));
    render(<App />);

    await fillAndSubmit("jane@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(/too many attempts/i);
    expect(screen.getByRole("button", { name: /^join$/i })).toBeEnabled();
  });

  it("server-rejected as invalid: a 400 response is shown as an invalid-email message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(400, { error: "validation_error" }));
    render(<App />);

    await fillAndSubmit("jane@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(/valid email/i);
  });

  it("network error: a rejected fetch shows a generic retry message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<App />);

    await fillAndSubmit("jane@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(/check your connection/i);
  });

  it("never puts the submitted email in the request URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, { status: "joined" }));
    render(<App />);

    await fillAndSubmit("jane@example.com");
    await screen.findByRole("status");

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(String(url)).not.toContain("jane@example.com");
  });
});
