import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../repositories/postgres.js";
import type { CheckRepository } from "../repositories/types.js";
import { schema, type Database } from "@fact-checker-ke/db";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * ADR-0038 Wave 3: `CheckRepository.listHomeFeed` + the two rails against the
 * REAL Postgres repository (not the in-memory double) — proves the unified feed
 * surfaces open threads, enforces the named-person stance-withholding rule, and
 * keyset-paginates in SQL (`::numeric` / `::uuid` casts, NULLS-LAST ordering).
 *
 * The test DB is shared and never rolled back, so this run's rows are tagged
 * with a unique token and given virality values far above any realistic
 * (log-weighted ~tens) score, making them the globally-highest rows so ordering
 * + keyset assertions stay deterministic regardless of accumulation.
 */
const connectionString = requireIntegrationDatabaseUrl();
const TOKEN = `wave3-${randomUUID()}`;
const HUGE = 90_000_000; // within numeric(12,4) max (< 10^8); still leads the feed

describe.skipIf(!connectionString)("GET /v1/feed/home — CheckRepository.listHomeFeed (integration)", () => {
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

  async function seedCheck(opts: {
    marker: string;
    lifecycleState: (typeof schema.checks.$inferSelect)["lifecycleState"];
    authoritative: boolean;
    rating: (typeof schema.checks.$inferSelect)["rating"];
    riskTier: "A" | "B" | "C";
    isDraft: boolean;
    publishedAt: Date | null;
    viralityScore: number | null;
  }): Promise<string> {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `${TOKEN}-${opts.marker}`, ingestSource: opts.isDraft ? "submission" : "fetch" })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: `${TOKEN}:${opts.marker}`,
        rating: opts.rating,
        isDraft: opts.isDraft,
        publishedAt: opts.publishedAt,
        riskTier: opts.riskTier,
        lifecycleState: opts.lifecycleState,
        authoritative: opts.authoritative,
        viralityScore: opts.viralityScore === null ? null : String(opts.viralityScore),
      })
      .returning();
    return check!.id;
  }

  const mine = (items: { claim: string }[]) => items.filter((i) => i.claim.startsWith(`${TOKEN}:`)).map((i) => i.claim.split(":")[1] ?? "");

  it("surfaces open threads + published, withholds named-person ratings, and keyset-paginates", async () => {
    await seedCheck({ marker: "pub", lifecycleState: "published", authoritative: true, rating: "True", riskTier: "A", isDraft: false, publishedAt: new Date(), viralityScore: HUGE + 30 });
    await seedCheck({ marker: "prelim", lifecycleState: "preliminary", authoritative: false, rating: "False", riskTier: "A", isDraft: true, publishedAt: null, viralityScore: HUGE + 20 });
    await seedCheck({ marker: "named", lifecycleState: "preliminary", authoritative: false, rating: "False", riskTier: "C", isDraft: true, publishedAt: null, viralityScore: HUGE + 10 });
    await seedCheck({ marker: "awaiting", lifecycleState: "awaiting_sources", authoritative: false, rating: null, riskTier: "A", isDraft: true, publishedAt: null, viralityScore: HUGE + 5 });
    await seedCheck({ marker: "editor", lifecycleState: "editor_review", authoritative: false, rating: null, riskTier: "C", isDraft: true, publishedAt: null, viralityScore: HUGE + 40 });

    const page = await checks.listHomeFeed({ limit: 50 });
    const items = page.items as unknown as { claim: string; rating: string | null }[];
    const markers = mine(items);

    // Open threads + published surfaced; editor_review excluded.
    expect(markers).toEqual(expect.arrayContaining(["pub", "prelim", "named", "awaiting"]));
    expect(markers).not.toContain("editor");

    const by = (m: string) => items.find((i) => i.claim === `${TOKEN}:${m}`)!;
    expect(by("prelim").rating).toBe("False"); // non-named preliminary: AI stance exposed
    expect(by("named").rating).toBeNull(); // named-person 'C': withheld
    expect(by("awaiting").rating).toBeNull();
    expect(by("pub").rating).toBe("True");

    // Keyset walk (accumulation-tolerant: the shared DB may hold other runs' rows,
    // so assert the RELATIVE order of THIS run's rows across the paged walk, with
    // no skip and no duplicate — not that a given page equals exact contents).
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 200; page++) {
      const res: { items: unknown[]; nextCursor: string | null } = await checks.listHomeFeed({ limit: 2, cursor });
      seen.push(...mine(res.items as { claim: string }[]));
      cursor = res.nextCursor;
      if (!cursor || seen.length >= 4) break;
    }
    // Virality DESC: pub(+30) > prelim(+20) > named(+10) > awaiting(+5); editor excluded.
    expect(seen).toEqual(["pub", "prelim", "named", "awaiting"]);
    expect(new Set(seen).size).toBe(seen.length); // no duplicate across pages

    // Rails: viral excludes nulls; among THIS run's rows it preserves virality order.
    const viral = await checks.listHomeRailViral({ limit: 500 });
    expect(mine(viral as unknown as { claim: string }[])).toEqual(["pub", "prelim", "named", "awaiting"]);
  });
});
