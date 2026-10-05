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
    expect(res.json()).toEqual({ items: [], nextCursor: null });
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
