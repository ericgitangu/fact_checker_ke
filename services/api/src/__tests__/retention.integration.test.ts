import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { runRetentionSweep } from "../lib/retention.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0021-1: "An unpublished anonymous submission with no claim found
 * is gone from Postgres 30 days after creation." Seeds a submission
 * with a backdated `created_at` (direct SQL — drizzle's insert always
 * sets `created_at` to `now()` via its column default) and asserts the
 * sweep deletes it, while a FRESH submission (inside the window) survives.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("Retention sweep (ADR-0021, integration)", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(() => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
  });

  afterAll(async () => {
    await close();
  });

  it("AT-0021-1: deletes a stale, unpublished, no-claim anonymous submission; keeps a fresh one", async () => {
    const [stale] = await db.insert(schema.submissions).values({ url: null, text: `stale-${randomUUID()}` }).returning();
    await db.execute(sql`update submissions set created_at = now() - interval '31 days' where id = ${stale!.id}`);

    const [fresh] = await db.insert(schema.submissions).values({ url: null, text: `fresh-${randomUUID()}` }).returning();

    const result = await runRetentionSweep(db);
    expect(result.anonymousSubmissionsDeleted).toBeGreaterThanOrEqual(1);

    const staleRow = await db.select().from(schema.submissions).where(eq(schema.submissions.id, stale!.id));
    expect(staleRow).toHaveLength(0);

    const freshRow = await db.select().from(schema.submissions).where(eq(schema.submissions.id, fresh!.id));
    expect(freshRow).toHaveLength(1);
  });

  it("does not delete a submission that already has a check (a claim WAS found)", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `has-claim-${randomUUID()}` })
      .returning();
    await db.execute(sql`update submissions set created_at = now() - interval '31 days' where id = ${submission!.id}`);
    await db.insert(schema.checks).values({ submissionId: submission!.id, summary: "x", isDraft: true });

    await runRetentionSweep(db);

    const row = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submission!.id));
    expect(row).toHaveLength(1);
  });

  it("a named-person draft older than 90 days is swept; a fresh one is kept", async () => {
    const [submission] = await db.insert(schema.submissions).values({ url: null, text: `np-${randomUUID()}` }).returning();
    const [staleCheck] = await db
      .insert(schema.checks)
      .values({ submissionId: submission!.id, summary: "stale named-person draft", isDraft: true })
      .returning();
    await db.execute(sql`update checks set created_at = now() - interval '91 days' where id = ${staleCheck!.id}`);
    await db.insert(schema.claims).values({ checkId: staleCheck!.id, text: "x", claimType: "checkable", namedPerson: true });

    const [submission2] = await db.insert(schema.submissions).values({ url: null, text: `np2-${randomUUID()}` }).returning();
    const [freshCheck] = await db
      .insert(schema.checks)
      .values({ submissionId: submission2!.id, summary: "fresh named-person draft", isDraft: true })
      .returning();
    await db.insert(schema.claims).values({ checkId: freshCheck!.id, text: "x", claimType: "checkable", namedPerson: true });

    const result = await runRetentionSweep(db);
    expect(result.namedPersonDraftsDeleted).toBeGreaterThanOrEqual(1);

    const staleRow = await db.select().from(schema.checks).where(eq(schema.checks.id, staleCheck!.id));
    expect(staleRow).toHaveLength(0);
    const freshRow = await db.select().from(schema.checks).where(eq(schema.checks.id, freshCheck!.id));
    expect(freshRow).toHaveLength(1);
  });
});
