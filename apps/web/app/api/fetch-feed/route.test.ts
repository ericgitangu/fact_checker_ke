import { afterEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn(async () => [{ address: "104.18.0.1", family: 4 }]);
vi.mock("node:dns/promises", () => ({ lookup: () => lookupMock() }));

const { GET, POST } = await import("./route");

const FEED = "https://pesacheck.org/tagged/kenya/feed";
const RSS = '<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>';

function get(url: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/fetch-feed?url=${encodeURIComponent(url)}`)) as Promise<Response>;
}

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  lookupMock.mockReset();
  lookupMock.mockImplementation(async () => [{ address: "104.18.0.1", family: 4 }]);
});

describe("GET /api/fetch-feed", () => {
  it("returns the feed body as XML, following an allowlisted redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://pesacheck.org/tag/kenya/rss/"))
      .mockResolvedValueOnce(new Response(RSS, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await get(FEED);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    expect(await res.text()).toBe(RSS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).accept).toContain("application/rss+xml");
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("Chrome/");
  });

  it("accepts www./subdomain forms and africacheck.org", async () => {
    const fetchMock = vi.fn(async () => new Response(RSS, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await get("https://www.pesacheck.org/rss")).status).toBe(200);
    expect((await get("https://africacheck.org/feed")).status).toBe(200);
  });

  it("rejects non-allowlisted hosts with 400 and never fetches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const u of [
      "https://example.com/feed",
      "http://169.254.169.254/latest/meta-data/",
      "https://pesacheck.org.evil.test/feed",
      "https://evilpesacheck.org/feed",
      "ftp://pesacheck.org/feed",
      "https://pesacheck.org:8080/feed",
      "not a url",
    ]) {
      const res = await get(u);
      expect(res.status, u).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    expect((await GET(new Request("http://localhost/api/fetch-feed"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect hop to a metadata/private IP", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data/"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await get(FEED);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "blocked_hop" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect off the allowlist even to a public host", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://example.com/feed"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await get(FEED)).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an allowlisted host that DNS-resolves to a private IP", async () => {
    lookupMock.mockImplementation(async () => [{ address: "10.0.0.5", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await get(FEED);
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("errors (does not hang) on timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      const pending = get(FEED);
      await vi.advanceTimersByTimeAsync(8100);
      const res = await pending;
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("errors on an oversized streamed body", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk); // endless; the cap must cut it off
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const res = await get(FEED);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("errors on an oversized declared content-length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } })),
    );
    expect((await get(FEED)).status).toBe(502);
  });

  it("errors on a non-2xx upstream (e.g. Cloudflare 403)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    const res = await get(FEED);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream_status" });
  });

  it("gives up after the redirect cap", async () => {
    const fetchMock = vi.fn(async () => redirect("https://pesacheck.org/loop"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await get(FEED);
    expect(res.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe("POST /api/fetch-feed", () => {
  it("accepts { url } and enforces the same allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(RSS, { status: 200 })));
    const post = (url: unknown) =>
      POST(
        new Request("http://localhost/api/fetch-feed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      );
    expect((await post(FEED)).status).toBe(200);
    expect((await post("https://example.com/feed")).status).toBe(400);
  });
});
