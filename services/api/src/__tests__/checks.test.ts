import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryCheckRepository } from "../repositories/in-memory.js";

describe("GET /v1/checks/:id", () => {
  it("returns 404 for an unknown check id", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/v1/checks/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("ADR-0018 caching table: a DRAFT check is private, no-store", async () => {
    const checks = new InMemoryCheckRepository();
    const id = randomUUID();
    checks.seed({
      id,
      submissionId: randomUUID(),
      summary: "a draft summary",
      rating: null,
      claims: [],
      sources: [],
      isDraft: true,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      publishedAt: null,
    });

    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: `/v1/checks/${id}` });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers.etag).toBeUndefined();
    await app.close();
  });

  it("ADR-0018 caching table: a PUBLISHED check gets s-maxage + a strong ETag, and 304s on If-None-Match", async () => {
    const checks = new InMemoryCheckRepository();
    const id = randomUUID();
    checks.seed({
      id,
      submissionId: randomUUID(),
      summary: "a published summary",
      rating: "MostlyTrue",
      claims: [],
      sources: [],
      isDraft: false,
      reviewedBy: "editor-1",
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    });

    const app = await buildApp({ logger: false, checks });
    const first = await app.inject({ method: "GET", url: `/v1/checks/${id}` });
    expect(first.headers["cache-control"]).toContain("s-maxage=300");
    expect(first.headers.etag).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v1/checks/${id}`,
      headers: { "if-none-match": first.headers.etag as string },
    });
    expect(second.statusCode).toBe(304);
    await app.close();
  });
});
