import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryTrendingRepository } from "../repositories/in-memory.js";

describe("GET /v1/trending", () => {
  it("returns an empty stream (not an error) when nothing has been discovered", async () => {
    const app = await buildApp({ logger: false, trending: new InMemoryTrendingRepository() });
    const res = await app.inject({ method: "GET", url: "/v1/trending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    await app.close();
  });

  it("orders discovered items by viralityScore desc, nulls last, ties by observation recency", async () => {
    const trending = new InMemoryTrendingRepository();
    trending.seed({
      submissionId: "00000000-0000-0000-0000-00000000000a",
      title: "v10",
      platform: "youtube",
      sourceUrl: "https://youtube.com/watch?v=a",
      viralityScore: 10,
      engagement: { views: 100, likes: 5, comments: 1 },
      observedAt: "2026-10-01T00:00:00.000Z",
      submissionStatus: "received",
      check: null,
    });
    trending.seed({
      submissionId: "00000000-0000-0000-0000-00000000000b",
      title: "v30",
      platform: "youtube",
      sourceUrl: "https://youtube.com/watch?v=b",
      viralityScore: 30,
      engagement: { views: 9000, likes: 800, comments: 90 },
      observedAt: "2026-10-02T00:00:00.000Z",
      submissionStatus: "verifying",
      check: null,
    });
    trending.seed({
      submissionId: "00000000-0000-0000-0000-00000000000c",
      title: "v30newer",
      platform: "tiktok",
      sourceUrl: "https://tiktok.com/@x/video/c",
      viralityScore: 30,
      engagement: { views: 9000, likes: 800, comments: 90 },
      observedAt: "2026-10-04T00:00:00.000Z",
      submissionStatus: "analyzing",
      check: null,
    });
    trending.seed({
      submissionId: "00000000-0000-0000-0000-00000000000d",
      title: "noScore",
      platform: "youtube",
      sourceUrl: "https://youtube.com/watch?v=d",
      viralityScore: null,
      engagement: null,
      observedAt: "2026-10-09T00:00:00.000Z",
      submissionStatus: "received",
      check: null,
    });

    const app = await buildApp({ logger: false, trending });
    const res = await app.inject({ method: "GET", url: "/v1/trending" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ title: string; viralityScore: number | null }> };
    // Two 30s first (newer wins the tie), then 10, then the null-score item LAST.
    expect(body.items.map((i) => i.title)).toEqual(["v30newer", "v30", "v10", "noScore"]);
    await app.close();
  });

  it("derives a status per item and never exposes a held draft's checkId", async () => {
    const trending = new InMemoryTrendingRepository();
    const base = {
      platform: "youtube",
      sourceUrl: "https://youtube.com/watch?v=x",
      engagement: { views: 1000, likes: 50, comments: 5 },
    };
    // monitoring (in-flight)
    trending.seed({
      ...base,
      submissionId: "10000000-0000-0000-0000-000000000001",
      title: "monitoring item",
      viralityScore: 40,
      observedAt: "2026-10-01T00:00:00.000Z",
      submissionStatus: "analyzing",
      check: null,
    });
    // under_review (held draft) — must NOT leak the draft's checkId
    trending.seed({
      ...base,
      submissionId: "10000000-0000-0000-0000-000000000002",
      title: "under review item",
      viralityScore: 30,
      observedAt: "2026-10-02T00:00:00.000Z",
      submissionStatus: "ready",
      check: { checkId: "99999999-9999-9999-9999-999999999999", isDraft: true, publishedAt: null },
    });
    // published — links the checkId
    trending.seed({
      ...base,
      submissionId: "10000000-0000-0000-0000-000000000003",
      title: "published item",
      viralityScore: 20,
      observedAt: "2026-10-03T00:00:00.000Z",
      submissionStatus: "ready",
      check: {
        checkId: "88888888-8888-8888-8888-888888888888",
        isDraft: false,
        publishedAt: "2026-10-03T12:00:00.000Z",
      },
    });
    // dismissed (failed)
    trending.seed({
      ...base,
      submissionId: "10000000-0000-0000-0000-000000000004",
      title: "dismissed item",
      viralityScore: 10,
      observedAt: "2026-10-04T00:00:00.000Z",
      submissionStatus: "failed",
      check: null,
    });

    const app = await buildApp({ logger: false, trending });
    const res = await app.inject({ method: "GET", url: "/v1/trending" });
    const body = res.json() as {
      items: Array<{ title: string; status: string; checkId: string | null; publishedAt: string | null }>;
    };
    const byTitle = Object.fromEntries(body.items.map((i) => [i.title, i]));

    expect(byTitle["monitoring item"]?.status).toBe("monitoring");
    expect(byTitle["monitoring item"]?.checkId).toBeNull();

    expect(byTitle["under review item"]?.status).toBe("under_review");
    expect(byTitle["under review item"]?.checkId).toBeNull(); // draft id never exposed

    expect(byTitle["published item"]?.status).toBe("published");
    expect(byTitle["published item"]?.checkId).toBe("88888888-8888-8888-8888-888888888888");
    expect(byTitle["published item"]?.publishedAt).toBe("2026-10-03T12:00:00.000Z");

    expect(byTitle["dismissed item"]?.status).toBe("dismissed");
    expect(byTitle["dismissed item"]?.checkId).toBeNull();
    await app.close();
  });

  it("respects a limit and rejects an out-of-range one", async () => {
    const trending = new InMemoryTrendingRepository();
    for (let i = 0; i < 5; i++) {
      trending.seed({
        submissionId: `20000000-0000-0000-0000-00000000000${i}`,
        title: `item ${i}`,
        platform: "youtube",
        sourceUrl: `https://youtube.com/watch?v=${i}`,
        viralityScore: i,
        engagement: null,
        observedAt: `2026-10-0${i + 1}T00:00:00.000Z`,
        submissionStatus: "received",
        check: null,
      });
    }
    const app = await buildApp({ logger: false, trending });

    const ok = await app.inject({ method: "GET", url: "/v1/trending?limit=2" });
    expect((ok.json() as { items: unknown[] }).items).toHaveLength(2);

    const bad = await app.inject({ method: "GET", url: "/v1/trending?limit=500" });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("sends a cache-friendly header like the feed", async () => {
    const app = await buildApp({ logger: false, trending: new InMemoryTrendingRepository() });
    const res = await app.inject({ method: "GET", url: "/v1/trending" });
    expect(res.headers["cache-control"]).toBe("public, s-maxage=30, stale-while-revalidate=300");
    await app.close();
  });
});
