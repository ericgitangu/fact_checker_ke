import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryCheckRepository } from "../repositories/in-memory.js";
import type { Check } from "@fact-checker-ke/core";

function publishedCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: randomUUID(),
    submissionId: randomUUID(),
    summary: "a published summary",
    rating: "MostlyTrue",
    claims: [],
    sources: [],
    isDraft: false,
    reviewedBy: "editor-1",
    createdAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    calibratedConfidence: 0.75,
    whatWouldChangeThis: "A material correction.",
    context: "The claim restates a figure the cited release corrects; the number, not the topic, is what misleads.",
    evidence: [],
    riskTier: "A",
    ...overrides,
  };
}

describe("GET /v1/feed", () => {
  it("returns an empty feed (not an error) when nothing has published yet", async () => {
    const app = await buildApp({ logger: false, checks: new InMemoryCheckRepository() });
    const res = await app.inject({ method: "GET", url: "/v1/feed" });
    expect(res.statusCode).toBe(200);
    // `topViral` is additive + backward-compatible (empty when nothing viral).
    expect(res.json()).toEqual({ items: [], nextCursor: null, topViral: [] });
    await app.close();
  });

  it("ADR-0038 contract B: exposes lifecycleState/authoritative/sourceKind on each feed item (not stripped)", async () => {
    const checks = new InMemoryCheckRepository();
    const c = publishedCheck({ summary: "contract-b" });
    // Seed with explicit lifecycle read-fields (the 3rd seed arg).
    checks.seed(c, "submission", { lifecycleState: "published", authoritative: true, sourceKind: null });

    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: "/v1/feed" });
    const body = res.json() as {
      items: Array<{ claim: string; lifecycleState: string | null; authoritative: boolean; sourceKind: string | null }>;
    };
    const item = body.items.find((i) => i.claim === "contract-b");
    // The fields survive Fastify serialization (no response schema strips them).
    expect(item?.lifecycleState).toBe("published");
    expect(item?.authoritative).toBe(true);
    expect(item?.sourceKind).toBeNull();
    await app.close();
  });

  it("surfaces a top-3 'most viral' section by viralityScore desc, excluding nulls, ties by recency", async () => {
    const checks = new InMemoryCheckRepository();
    // Four viral (fetch) items with distinct scores + one tie, and one
    // submission item with no virality score (must be EXCLUDED from topViral).
    const v10 = publishedCheck({ summary: "v10", viralityScore: 10, publishedAt: "2026-09-01T00:00:00.000Z" });
    const v30 = publishedCheck({ summary: "v30", viralityScore: 30, publishedAt: "2026-09-02T00:00:00.000Z" });
    const v20 = publishedCheck({ summary: "v20", viralityScore: 20, publishedAt: "2026-09-03T00:00:00.000Z" });
    const v30newer = publishedCheck({ summary: "v30newer", viralityScore: 30, publishedAt: "2026-09-04T00:00:00.000Z" });
    const noScore = publishedCheck({ summary: "noScore", viralityScore: null, publishedAt: "2026-09-09T00:00:00.000Z" });

    for (const c of [v10, v30, v20, v30newer, noScore]) checks.seed(c, "fetch");

    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: "/v1/feed" });
    const body = res.json() as { topViral: Array<{ summary?: string; claim: string; viralityScore: number | null }> };

    // Top 3: the two 30s first (newer 30 wins the tie), then 20. The 10 and the
    // null-score item never make the cut.
    expect(body.topViral.map((i) => i.claim)).toEqual(["v30newer", "v30", "v20"]);
    expect(body.topViral.every((i) => i.viralityScore !== null)).toBe(true);
    await app.close();
  });

  it("omits topViral on a paginated (cursor) request — the viral section is first-page only", async () => {
    const checks = new InMemoryCheckRepository();
    checks.seed(publishedCheck({ viralityScore: 42, publishedAt: "2026-09-01T00:00:00.000Z" }), "fetch");
    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: "/v1/feed?cursor=2026-09-05T00:00:00.000Z" });
    const body = res.json() as { topViral: unknown[] };
    expect(body.topViral).toEqual([]);
    await app.close();
  });

  it("excludes drafts and returns published checks newest first, with ingest_source", async () => {
    const checks = new InMemoryCheckRepository();
    const older = publishedCheck({ publishedAt: "2026-09-01T00:00:00.000Z", summary: "older" });
    const newer = publishedCheck({ publishedAt: "2026-09-02T00:00:00.000Z", summary: "newer" });
    const draft = publishedCheck({ isDraft: true, publishedAt: null, rating: null, summary: "draft" });

    checks.seed(older, "submission");
    checks.seed(newer, "fetch");
    checks.seed(draft, "submission");

    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: "/v1/feed" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, s-maxage=30, stale-while-revalidate=300");

    const body = res.json() as { items: Array<{ id: string; ingestSource: string; claim: string }> };
    expect(body.items.map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(body.items.map((i) => i.claim)).toEqual(["newer", "older"]);
    expect(body.items.find((i) => i.id === newer.id)?.ingestSource).toBe("fetch");
    expect(body.items.find((i) => i.id === older.id)?.ingestSource).toBe("submission");
    await app.close();
  });

  it("rejects an out-of-range limit", async () => {
    const app = await buildApp({ logger: false, checks: new InMemoryCheckRepository() });
    const res = await app.inject({ method: "GET", url: "/v1/feed?limit=500" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
