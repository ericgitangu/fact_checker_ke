import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryCheckRepository } from "../repositories/in-memory.js";
import type { Check, Rating } from "@fact-checker-ke/core";
import type { CheckLifecycle } from "@fact-checker-ke/core";

/**
 * ADR-0038 Wave 3: `GET /v1/feed/home` — the unified public feed that surfaces
 * OPEN THREADS (preliminary / awaiting_sources) alongside published verdicts,
 * with keyset pagination and the named-person stance-withholding rule. Driven
 * against the in-memory `CheckRepository` double (the route is repo-agnostic).
 */

function baseCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: randomUUID(),
    submissionId: randomUUID(),
    summary: "a claim under examination",
    rating: null,
    claims: [],
    sources: [],
    isDraft: true,
    reviewedBy: null,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    calibratedConfidence: 0.6,
    whatWouldChangeThis: "A material correction.",
    context: "Context that leads the card.",
    evidence: [],
    riskTier: "A",
    viralityScore: null,
    ...overrides,
  };
}

function publishedCheck(overrides: Partial<Check> = {}): Check {
  return baseCheck({
    rating: "MostlyTrue",
    isDraft: false,
    reviewedBy: "editor-1",
    publishedAt: new Date().toISOString(),
    ...overrides,
  });
}

type HomeItem = {
  id: string;
  claim: string;
  lifecycleState: CheckLifecycle | null;
  authoritative: boolean;
  rating: Rating | null;
  riskTier: "A" | "B" | "C" | null;
  publishedAt: string | null;
  createdAt: string;
  viralityScore: number | null;
  sourceCount: number;
};

type HomeBody = { items: HomeItem[]; nextCursor: string | null; mostViral: HomeItem[]; mostRecent: HomeItem[] };

describe("GET /v1/feed/home (ADR-0038 Wave 3)", () => {
  it("returns an empty, well-formed body when nothing is eligible", async () => {
    const app = await buildApp({ logger: false, checks: new InMemoryCheckRepository() });
    const res = await app.inject({ method: "GET", url: "/v1/feed/home" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null, mostViral: [], mostRecent: [] });
    await app.close();
  });

  it("surfaces open threads (preliminary + awaiting_sources) AND published verdicts; excludes editor_review/dismissed/archived", async () => {
    const checks = new InMemoryCheckRepository();
    const pub = publishedCheck({ summary: "published", createdAt: "2026-09-10T00:00:00.000Z" });
    const prelim = baseCheck({ summary: "preliminary", createdAt: "2026-09-09T00:00:00.000Z", rating: "False" });
    const awaiting = baseCheck({ summary: "awaiting", createdAt: "2026-09-08T00:00:00.000Z" });
    const editor = baseCheck({ summary: "editor", createdAt: "2026-09-07T00:00:00.000Z" });
    const dismissed = baseCheck({ summary: "dismissed", createdAt: "2026-09-06T00:00:00.000Z" });
    const archived = baseCheck({ summary: "archived", createdAt: "2026-09-05T00:00:00.000Z" });

    checks.seed(pub, "fetch", { lifecycleState: "published", authoritative: true });
    checks.seed(prelim, "submission", { lifecycleState: "preliminary", authoritative: false });
    checks.seed(awaiting, "submission", { lifecycleState: "awaiting_sources", authoritative: false });
    checks.seed(editor, "submission", { lifecycleState: "editor_review", authoritative: false });
    checks.seed(dismissed, "submission", { lifecycleState: "dismissed", authoritative: true });
    checks.seed(archived, "fetch", { lifecycleState: "archived_expired", authoritative: true });

    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: "/v1/feed/home" });
    const body = res.json() as HomeBody;
    const claims = body.items.map((i) => i.claim);

    expect(claims).toContain("published");
    expect(claims).toContain("preliminary");
    expect(claims).toContain("awaiting");
    expect(claims).not.toContain("editor"); // private escalation queue
    expect(claims).not.toContain("dismissed");
    expect(claims).not.toContain("archived");
    await app.close();
  });

  it("exposes the rating ONLY for a non-authoritative, non-named preliminary — withholds it for named-person (C) and for awaiting_sources", async () => {
    const checks = new InMemoryCheckRepository();
    // A non-named (riskTier A) preliminary: authoritative=false, draft rating persisted → EXPOSED.
    const nonNamed = baseCheck({ summary: "non-named", riskTier: "A", rating: "False", createdAt: "2026-09-04T00:00:00.000Z" });
    // A named-person (riskTier C) preliminary: even if a rating were persisted, it is WITHHELD.
    const named = baseCheck({ summary: "named", riskTier: "C", rating: "False", createdAt: "2026-09-03T00:00:00.000Z" });
    // awaiting_sources: no draft rating at all → null.
    const awaiting = baseCheck({ summary: "awaiting", riskTier: "A", rating: null, createdAt: "2026-09-02T00:00:00.000Z" });
    // A published verdict always carries its rating.
    const pub = publishedCheck({ summary: "published", rating: "True", createdAt: "2026-09-01T00:00:00.000Z" });

    checks.seed(nonNamed, "submission", { lifecycleState: "preliminary", authoritative: false });
    checks.seed(named, "submission", { lifecycleState: "preliminary", authoritative: false });
    checks.seed(awaiting, "submission", { lifecycleState: "awaiting_sources", authoritative: false });
    checks.seed(pub, "fetch", { lifecycleState: "published", authoritative: true });

    const app = await buildApp({ logger: false, checks });
    const res = await app.inject({ method: "GET", url: "/v1/feed/home" });
    const body = res.json() as HomeBody;
    const by = (claim: string) => body.items.find((i) => i.claim === claim)!;

    expect(by("non-named").rating).toBe("False"); // AI draft stance exposed
    expect(by("named").rating).toBeNull(); // named-person: withheld (legal)
    expect(by("awaiting").rating).toBeNull();
    expect(by("published").rating).toBe("True");
    await app.close();
  });

  it("orders by virality DESC NULLS LAST, then recency; keyset-paginates without skipping or duplicating a row", async () => {
    const checks = new InMemoryCheckRepository();
    // Six eligible rows: three viral (distinct scores), three null-virality (ordered by recency).
    const seedPrelim = (summary: string, virality: number | null, createdAt: string) =>
      checks.seed(baseCheck({ summary, viralityScore: virality, createdAt, rating: "False" }), "fetch", {
        lifecycleState: "preliminary",
        authoritative: false,
      });
    seedPrelim("v30", 30, "2026-09-01T00:00:00.000Z");
    seedPrelim("v20", 20, "2026-09-02T00:00:00.000Z");
    seedPrelim("v10", 10, "2026-09-03T00:00:00.000Z");
    seedPrelim("n-c", null, "2026-09-06T00:00:00.000Z"); // newest among nulls
    seedPrelim("n-b", null, "2026-09-05T00:00:00.000Z");
    seedPrelim("n-a", null, "2026-09-04T00:00:00.000Z");

    const app = await buildApp({ logger: false, checks });

    // Page 1 (limit 2): the two highest-virality rows.
    const p1 = (await app.inject({ method: "GET", url: "/v1/feed/home?limit=2" })).json() as HomeBody;
    expect(p1.items.map((i) => i.claim)).toEqual(["v30", "v20"]);
    expect(p1.nextCursor).toBeTruthy();

    // Page 2.
    const p2 = (
      await app.inject({ method: "GET", url: `/v1/feed/home?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}` })
    ).json() as HomeBody;
    expect(p2.items.map((i) => i.claim)).toEqual(["v10", "n-c"]); // v10 then the first (newest) null

    // Page 3 (into the NULLS-LAST region).
    const p3 = (
      await app.inject({ method: "GET", url: `/v1/feed/home?limit=2&cursor=${encodeURIComponent(p2.nextCursor!)}` })
    ).json() as HomeBody;
    expect(p3.items.map((i) => i.claim)).toEqual(["n-b", "n-a"]);

    // Full walk visits each row exactly once (no skip/dup).
    const walked = [...p1.items, ...p2.items, ...p3.items].map((i) => i.claim);
    expect(new Set(walked).size).toBe(6);
    expect(walked.sort()).toEqual(["n-a", "n-b", "n-c", "v10", "v20", "v30"]);

    // The viral rail excludes null-virality rows; the recent rail is recency-first.
    expect(p1.mostViral.map((i) => i.claim)).toEqual(["v30", "v20", "v10"]);
    expect(p1.mostRecent.map((i) => i.claim)).toEqual(["n-c", "n-b", "n-a"]);
    await app.close();
  });

  it("omits the rails on a paginated (cursor) request — rails are first-page only", async () => {
    const checks = new InMemoryCheckRepository();
    checks.seed(baseCheck({ summary: "prelim", viralityScore: 5, createdAt: "2026-09-01T00:00:00.000Z", rating: "False" }), "fetch", {
      lifecycleState: "preliminary",
      authoritative: false,
    });
    const app = await buildApp({ logger: false, checks });
    const cursor = Buffer.from(JSON.stringify([null, "2026-10-01T00:00:00.000Z", randomUUID()]), "utf8").toString("base64url");
    const body = (await app.inject({ method: "GET", url: `/v1/feed/home?cursor=${cursor}` })).json() as HomeBody;
    expect(body.mostViral).toEqual([]);
    expect(body.mostRecent).toEqual([]);
    await app.close();
  });

  it("rejects an out-of-range limit", async () => {
    const app = await buildApp({ logger: false, checks: new InMemoryCheckRepository() });
    const res = await app.inject({ method: "GET", url: "/v1/feed/home?limit=999" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
