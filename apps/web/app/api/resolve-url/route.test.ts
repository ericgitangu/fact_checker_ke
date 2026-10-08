import { afterEach, describe, expect, it, vi } from "vitest";

// Public-looking address for every host unless a test overrides it.
const lookupMock = vi.fn(async (host: string) => [{ address: host ? "142.250.0.1" : "", family: 4 }]);
vi.mock("node:dns/promises", () => ({ lookup: (host: string) => lookupMock(host) }));

const { POST } = await import("./route");

function post(url: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/resolve-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  lookupMock.mockClear();
});

describe("POST /api/resolve-url", () => {
  it("rejects a non-allowlisted host with 400 and never fetches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post("http://169.254.169.254/latest/meta-data/");
    expect(res.status).toBe(400);
    expect((await post("https://example.com/x")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows redirects with GET + Range and returns the cleaned final URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/interstitial"))
      .mockResolvedValueOnce(redirect("https://www.youtube.com/watch?v=vi0YPg-QLB0&shem=abc&si=zzz"))
      .mockResolvedValueOnce(new Response(null, { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post("https://share.google/NHHtEozjG6LQwKgmp");

    expect(await res.json()).toEqual({ resolvedUrl: "https://www.youtube.com/watch?v=vi0YPg-QLB0" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect((init.headers as Record<string, string>).range).toBe("bytes=0-0");
    }
  });

  it("refuses a hop that resolves to a metadata/private address and falls back to the original", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data/"));
    vi.stubGlobal("fetch", fetchMock);

    const original = "https://bit.ly/abc";
    const res = await post(original);

    expect(await res.json()).toEqual({ resolvedUrl: original });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the private hop was never fetched
  });

  it("refuses a hop whose hostname DNS-resolves to a private IP", async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host === "internal.evil.test" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "142.250.0.1", family: 4 }],
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://internal.evil.test/x"));
    vi.stubGlobal("fetch", fetchMock);

    const original = "https://t.co/abc";
    expect(await (await post(original)).json()).toEqual({ resolvedUrl: original });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    lookupMock.mockImplementation(async () => [{ address: "142.250.0.1", family: 4 }]);
  });

  it("falls back to the original URL on timeout/abort (best-effort, never throws)", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      const pending = post("https://share.google/slow");
      await vi.advanceTimersByTimeAsync(3100);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ resolvedUrl: "https://share.google/slow" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the redirect budget and returns the original", async () => {
    const fetchMock = vi.fn(async () => redirect("https://www.google.com/loop"));
    vi.stubGlobal("fetch", fetchMock);
    const original = "https://goo.gl/loop";
    expect(await (await post(original)).json()).toEqual({ resolvedUrl: original });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
