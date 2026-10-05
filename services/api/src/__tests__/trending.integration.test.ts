import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../repositories/postgres.js";
import type { TrendingRepository } from "../repositories/types.js";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * "Trending / under review" stream against the REAL Postgres repository (not
 * the in-memory double). Seeds fetch-sourced submissions carrying the
 * discovery columns (source_url/platform/engagement/virality_score — migration
 * 0020) in each of the four derived-status situations, plus a reader
 * (submission-sourced) row that must NEVER appear, then asserts ordering
 * (virality DESC NULLS LAST), status derivation, and that a held draft's
 * checkId is not exposed.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("GET /v1/trending — TrendingRepository.listTrending (integration)", () => {
  let db: Database;
  let trending: TrendingRepository;
  let close: () => Promise<void>;

  beforeAll(() => {
    const repos = createPostgresRepositories(connectionString as string);
    db = repos.db;
    trending = repos.trending;
    close = repos.close;
  });

  afterAll(async () => {
    await close();
  });

  async function seedFetchSubmission(opts: {
    marker: string;
    status: "received" | "analyzing" | "analyzed" | "verifying" | "ready" | "failed";
    viralityScore: number | null;
    check?: { isDraft: boolean; publishedAt: Date | null };
  }): Promise<string> {
    const [submission] = await db
      .insert(schema.submissions)
      .values({
        url: null,
        text: `${opts.marker}: a viral discovered claim`,
        ingestSource: "fetch",
        status: opts.status,
        sourceUrl: "https://www.youtube.com/watch?v=" + randomUUID().slice(0, 8),
        platform: "youtube",
        engagement: { views: 100000, likes: 4000, comments: 250 },
        viralityScore: opts.viralityScore === null ? null : String(opts.viralityScore),
      })
      .returning();

    if (opts.check) {
      await db.insert(schema.checks).values({
        submissionId: submission!.id,
        summary: `${opts.marker}: held or published assessment`,
        rating: opts.check.isDraft ? null : "MostlyTrue",
        isDraft: opts.check.isDraft,
        publishedAt: opts.check.publishedAt,
        calibratedConfidence: opts.check.isDraft ? null : "0.8200",
        whatWouldChangeThis: opts.check.isDraft ? null : "A material correction.",
        riskTier: opts.check.isDraft ? null : "A",
        ingestSource: "fetch",
      });
    }

    return submission!.id;
  }

  it("surfaces fetch discoveries ranked by virality, with a derived status, never leaking a draft's checkId", async () => {
    const marker = `trending-${randomUUID()}`;

    const monitoring = await seedFetchSubmission({ marker: `${marker}-mon`, status: "verifying", viralityScore: 500.5 });
    const underReview = await seedFetchSubmission({
      marker: `${marker}-rev`,
      status: "ready",
      viralityScore: 400.4,
      check: { isDraft: true, publishedAt: null },
    });
    const published = await seedFetchSubmission({
      marker: `${marker}-pub`,
      status: "ready",
      viralityScore: 300.3,
      check: { isDraft: false, publishedAt: new Date("2026-10-04T00:00:00.000Z") },
    });
    const dismissed = await seedFetchSubmission({ marker: `${marker}-dis`, status: "failed", viralityScore: 200.2 });
    const nullScore = await seedFetchSubmission({ marker: `${marker}-nul`, status: "received", viralityScore: null });

    // A reader submission must NEVER appear in the trending (fetch-only) stream.
    const [readerSub] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `${marker}-reader`, ingestSource: "submission", status: "received" })
      .returning();

    const all = await trending.listTrending({ limit: 5000 });
    const mine = all.filter((i) => i.title.startsWith(marker));
    const byId = Object.fromEntries(mine.map((i) => [i.submissionId, i]));

    // Reader submission excluded.
    expect(mine.map((i) => i.submissionId)).not.toContain(readerSub!.id);
    // Every surfaced item is fetch-sourced.
    expect(mine.every((i) => i.ingestSource === "fetch")).toBe(true);

    // Ordering within this test's own rows: virality DESC, null LAST.
    expect(mine.map((i) => i.submissionId)).toEqual([monitoring, underReview, published, dismissed, nullScore]);

    // Derived statuses.
    expect(byId[monitoring]!.status).toBe("monitoring");
    expect(byId[monitoring]!.checkId).toBeNull();

    expect(byId[underReview]!.status).toBe("under_review");
    expect(byId[underReview]!.checkId).toBeNull(); // draft id NEVER exposed
    expect(byId[underReview]!.publishedAt).toBeNull();

    expect(byId[published]!.status).toBe("published");
    expect(byId[published]!.checkId).not.toBeNull();
    expect(byId[published]!.publishedAt).toBe("2026-10-04T00:00:00.000Z");

    expect(byId[dismissed]!.status).toBe("dismissed");
    expect(byId[dismissed]!.checkId).toBeNull();

    expect(byId[nullScore]!.status).toBe("monitoring");

    // Discovery metadata carried through.
    expect(byId[monitoring]!.platform).toBe("youtube");
    expect(byId[monitoring]!.sourceUrl).toMatch(/youtube\.com\/watch/);
    expect(byId[monitoring]!.engagement).toEqual({ views: 100000, likes: 4000, comments: 250 });
  });

  it("respects the limit", async () => {
    const two = await trending.listTrending({ limit: 2 });
    expect(two.length).toBeLessThanOrEqual(2);
  });
});
