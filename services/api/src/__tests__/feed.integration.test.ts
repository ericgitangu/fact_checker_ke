import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../repositories/postgres.js";
import type { CheckRepository } from "../repositories/types.js";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
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
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const newer = await seedPublishedCheck({
      ingestSource: "fetch",
      summary: "feed-test: an autonomously-fetched claim, newer",
      publishedAt: new Date("2026-09-02T00:00:00.000Z"),
      withSource: true,
    });
    const draftId = await seedDraftCheck();

    // A generous limit: this integration suite's OTHER test files also
    // publish checks (with `publishedAt: new Date()`, i.e. newer than
    // this test's fixed Sept 2026 dates) against the same shared test
    // database, all in the same `api:test-integration` run — a small
    // limit would let those push this test's rows off the page purely
    // on recency, which is a test-isolation artefact, not a real
    // assertion about `listPublished`'s behaviour.
    const items = await checks.listPublished({ limit: 5000 });
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
    const low = await seedPublishedCheck({ ingestSource: "fetch", summary: `${marker}-low`, publishedAt: new Date("2026-09-10T00:00:00.000Z"), viralityScore: 900.1 });
    const highOld = await seedPublishedCheck({ ingestSource: "fetch", summary: `${marker}-highOld`, publishedAt: new Date("2026-09-11T00:00:00.000Z"), viralityScore: 999.9 });
    const highNew = await seedPublishedCheck({ ingestSource: "fetch", summary: `${marker}-highNew`, publishedAt: new Date("2026-09-12T00:00:00.000Z"), viralityScore: 999.9 });
    const nullScore = await seedPublishedCheck({ ingestSource: "submission", summary: `${marker}-null`, publishedAt: new Date("2026-09-13T00:00:00.000Z"), viralityScore: null });

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
    const published = await checks.listPublished({ limit: 5000 });
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
