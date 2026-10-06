import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../repositories/postgres.js";
import type { CheckRepository } from "../repositories/types.js";
import { schema, type Database } from "@fact-checker-ke/db";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * ADR-0032 payoff: `CheckRepository.listPublished` against the real
 * Postgres repository (not the in-memory double) — seeds a published
 * submission-sourced check, a published fetch-sourced check (with a
 * cited source via `check_evidence`), and a draft, and asserts the feed
 * returns only the two published rows, newest first, with the draft
 * excluded and provenance/sources carried through.
 */
const connectionString = requireIntegrationDatabaseUrl();

/**
 * `listPublished` is a GLOBAL newest-first feed (ORDER BY published_at DESC
 * LIMIT n) over a live, shared test Postgres with NO per-test rollback, and
 * the other integration files publish checks against the same DB every run.
 * Seeding this test's rows at a FIXED past date (the former Sept-2026 values)
 * let that accumulation push them off the page once the DB held more newer
 * published checks than the limit -- an isolation artefact, not a real claim
 * about `listPublished`. Anchoring `published_at` to `Date.now()` + ~100 years
 * makes THIS run's rows the globally-newest published checks (and unique per
 * run, since Date.now() is monotonic across runs), so they always lead the
 * feed and the contract assertions below -- presence, newest-first ordering,
 * provenance, viral ranking -- stay deterministic no matter how many rows have
 * accumulated. ~100y ahead is still well within Postgres timestamptz range.
 */
const FUTURE_EPOCH_MS = Date.now() + 1000 * 60 * 60 * 24 * 365 * 100;
const DAY_MS = 1000 * 60 * 60 * 24;
const futureDate = (offsetDays: number): Date => new Date(FUTURE_EPOCH_MS + offsetDays * DAY_MS);

describe.skipIf(!connectionString)("GET /v1/feed — CheckRepository.listPublished (integration)", () => {
  let db: Database;
  let checks: CheckRepository;
  let close: () => Promise<void>;

  beforeAll(() => {
    const repos = createPostgresRepositories(connectionString as string);
    db = repos.db;
    checks = repos.checks;
    close = repos.close;
  });

  afterAll(async () => {
    await close();
  });

  async function seedPublishedCheck(opts: {
    ingestSource: "submission" | "fetch";
    summary: string;
    publishedAt: Date;
    withSource?: boolean;
    viralityScore?: number | null;
  }): Promise<string> {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `feed-${randomUUID()}`, ingestSource: opts.ingestSource })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: opts.summary,
        rating: "MostlyTrue",
        isDraft: false,
        publishedAt: opts.publishedAt,
        calibratedConfidence: "0.8200",
        whatWouldChangeThis: "A material correction to the underlying figures.",
        riskTier: "A",
        ingestSource: opts.ingestSource,
        viralityScore:
          opts.viralityScore === undefined || opts.viralityScore === null ? null : String(opts.viralityScore),
      })
      .returning();

    if (opts.withSource) {
      const [source] = await db
        .insert(schema.sources)
        .values({
          url: "https://example.com/knbs-report",
          title: "KNBS quarterly report",
          publisher: "Kenya National Bureau of Statistics",
          credibilityTier: "tier1_primary",
        })
        .returning();
      await db.insert(schema.checkEvidence).values({
        checkId: check!.id,
        sourceId: source!.id,
        quote: "The reported figure matches the official release.",
      });
    }

    return check!.id;
  }

  async function seedDraftCheck(): Promise<string> {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `feed-draft-${randomUUID()}` })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "a draft, never published",
        rating: null,
        isDraft: true,
        publishedAt: null,
      })
      .returning();
    return check!.id;
  }

  it("returns only published checks, newest first, excluding drafts — with ingest_source + cited sources carried through", async () => {
    const older = await seedPublishedCheck({
      ingestSource: "submission",
      summary: "feed-test: a submitted claim, older",
      publishedAt: futureDate(0),
    });
    const newer = await seedPublishedCheck({
      ingestSource: "fetch",
      summary: "feed-test: an autonomously-fetched claim, newer",
      publishedAt: futureDate(1),
      withSource: true,
    });
    const draftId = await seedDraftCheck();

    // These two rows are far-future dated (see `futureDate`), so they are the
    // globally-newest published checks and always lead the feed regardless of
    // how many rows the shared DB has accumulated — a modest limit suffices.
    const items = await checks.listPublished({ limit: 50 });
    const ids = items.map((i) => i.id);

    expect(ids).not.toContain(draftId);
    expect(ids).toContain(older);
    expect(ids).toContain(newer);

    const newerIndex = ids.indexOf(newer);
    const olderIndex = ids.indexOf(older);
    expect(newerIndex).toBeLessThan(olderIndex);

    const newerItem = items.find((i) => i.id === newer)!;
    expect(newerItem.ingestSource).toBe("fetch");
    expect(newerItem.sources).toHaveLength(1);
    expect(newerItem.sources[0]!.publisher).toBe("Kenya National Bureau of Statistics");

    const olderItem = items.find((i) => i.id === older)!;
    expect(olderItem.ingestSource).toBe("submission");
    expect(olderItem.sources).toHaveLength(0);
  });

  it("listTopViral ranks by viralityScore desc (ties by recency), excludes nulls, and does not disturb listPublished", async () => {
    // Three fetch items with distinct, deliberately-high virality scores (far
    // above anything other suites seed, which leave virality null), plus a
    // null-score published item that must be EXCLUDED from the ranking.
    const marker = `viral-${randomUUID()}`;
    // Far-future, strictly-increasing dates (see `futureDate`) keep highNew
    // newer than highOld — the recency tie-break between the two equal 999.9
    // scores — and make all four the globally-newest published rows so the
    // `listPublished` presence checks below are accumulation-robust.
    const low = await seedPublishedCheck({ ingestSource: "fetch", summary: `${marker}-low`, publishedAt: futureDate(10), viralityScore: 900.1 });
    const highOld = await seedPublishedCheck({ ingestSource: "fetch", summary: `${marker}-highOld`, publishedAt: futureDate(11), viralityScore: 999.9 });
    const highNew = await seedPublishedCheck({ ingestSource: "fetch", summary: `${marker}-highNew`, publishedAt: futureDate(12), viralityScore: 999.9 });
    const nullScore = await seedPublishedCheck({ ingestSource: "submission", summary: `${marker}-null`, publishedAt: futureDate(13), viralityScore: null });

    // A top-3 call returns at most 3, all non-null, globally sorted desc —
    // asserted without pinning WHICH rows (other runs may leave viral rows in
    // the shared DB), so this stays isolation-robust.
    const top3 = await checks.listTopViral({ limit: 3 });
    expect(top3.length).toBeLessThanOrEqual(3);
    expect(top3.every((i) => i.viralityScore !== null)).toBe(true);
    for (let i = 1; i < top3.length; i += 1) {
      expect(top3[i - 1]!.viralityScore!).toBeGreaterThanOrEqual(top3[i]!.viralityScore!);
    }

    // Ranking semantics, pinned to THIS test's own rows (filter by marker):
    // null excluded, score desc, ties broken by recency.
    const mine = (await checks.listTopViral({ limit: 5000 })).filter((i) => i.claim.startsWith(marker));
    expect(mine.map((i) => i.id)).toEqual([highNew, highOld, low]);
    expect(mine.map((i) => i.id)).not.toContain(nullScore);

    // listPublished (descending feed) still returns every published row,
    // including the null-score one — the viral ranking is purely additive.
    // These rows are far-future dated (see `futureDate`), so they lead the
    // feed and a modest limit captures them regardless of accumulation.
    const published = await checks.listPublished({ limit: 50 });
    const publishedIds = published.map((i) => i.id);
    expect(publishedIds).toContain(nullScore);
    expect(publishedIds).toContain(highNew);
  });

  it("keyset-paginates via cursor", async () => {
    const first = await checks.listPublished({ limit: 1 });
    expect(first.length).toBeLessThanOrEqual(1);
    if (first.length === 1) {
      const second = await checks.listPublished({ limit: 1, cursor: first[0]!.publishedAt });
      if (second.length === 1) {
        expect(second[0]!.id).not.toBe(first[0]!.id);
        expect(second[0]!.publishedAt < first[0]!.publishedAt).toBe(true);
      }
    }
  });
});
