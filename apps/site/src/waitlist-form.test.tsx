import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { WaitlistForm } from "./waitlist-form";

async function submit(email = "jane@example.com"): Promise<void> {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /join/i }));
  });
}
const text = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("WaitlistForm failure classes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("missing VITE_API_URL never issues a relative request", async () => {
    vi.stubEnv("VITE_API_URL", undefined as unknown as string);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(text(404));
    render(<WaitlistForm />);
    await submit();
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => /^https?:\/\//.test(u))).toBe(true);
  });

  it("5xx reads as a temporary server problem, not a network problem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(text(503));
    render(<WaitlistForm />);
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent(/temporarily unavailable/i);
  });

  it("an unexpected 4xx (e.g. 404) is reported as unexpected, not network", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(text(404));
    render(<WaitlistForm />);
    await submit();
    expect(screen.getByRole("status")).not.toHaveTextContent(/connection/i);
    expect(screen.getByRole("status")).toHaveTextContent(/unexpected/i);
  });

  it("a rejected fetch is the only path to the connection message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<WaitlistForm />);
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent(/connection/i);
  });

  it("429 honours Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(text(429, "", { "retry-after": "30" }));
    render(<WaitlistForm />);
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent(/30 seconds/i);
  });
});

describe("WaitlistForm contract drift", () => {
  afterEach(() => vi.restoreAllMocks());
  it("a 2xx with a malformed body is unexpected, not a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":true}', { status: 201 }));
    render(<WaitlistForm />);
    await submit();
    expect(screen.getByRole("status")).toHaveTextContent(/unexpected/i);
  });
});
