import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { runRetentionSweep, runDsarExport } from "../lib/retention.js";
import { hashDeviceToken } from "../lib/device-token.js";
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

  it("ADR-0020 review finding: prunes totp_used_codes rows older than the safe replay cutoff, keeps recent ones", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `totp-prune-${randomUUID()}@example.test`, passwordHash: "x", role: "editor" })
      .returning();

    const [oldCode] = await db
      .insert(schema.totpUsedCodes)
      .values({ userId: user!.id, counter: 1 })
      .returning();
    await db.execute(sql`update totp_used_codes set created_at = now() - interval '2 days' where id = ${oldCode!.id}`);

    const [recentCode] = await db
      .insert(schema.totpUsedCodes)
      .values({ userId: user!.id, counter: 2 })
      .returning();

    const result = await runRetentionSweep(db);
    expect(result.totpUsedCodesPruned).toBeGreaterThanOrEqual(1);

    const oldRow = await db.select().from(schema.totpUsedCodes).where(eq(schema.totpUsedCodes.id, oldCode!.id));
    expect(oldRow).toHaveLength(0);

    const recentRow = await db.select().from(schema.totpUsedCodes).where(eq(schema.totpUsedCodes.id, recentCode!.id));
    expect(recentRow).toHaveLength(1);
  });

  it("AT-0021-4: a DSAR export for a known device token returns that token's submissions and unpublished drafts, but never a published check", async () => {
    const [editor] = await db
      .insert(schema.users)
      .values({ email: `dsar-editor-${randomUUID()}@example.test`, passwordHash: "x", role: "editor" })
      .returning();

    const deviceToken = `device-${randomUUID()}`;
    const deviceTokenHash = hashDeviceToken(deviceToken);

    const [ownSubmission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `dsar-own-${randomUUID()}`, deviceTokenHash })
      .returning();
    const [draftCheck] = await db
      .insert(schema.checks)
      .values({ submissionId: ownSubmission!.id, summary: "An unpublished draft on the own submission.", isDraft: true })
      .returning();

    const [publishedSubmission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `dsar-published-${randomUUID()}`, deviceTokenHash })
      .returning();
    await db.insert(schema.checks).values({
      submissionId: publishedSubmission!.id,
      summary: "A published verdict that must never appear in a DSAR export.",
      rating: "True",
      isDraft: false,
      publishedAt: new Date(),
    });

    const [otherSubmission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `dsar-other-${randomUUID()}`, deviceTokenHash: hashDeviceToken(`device-other-${randomUUID()}`) })
      .returning();

    const result = await runDsarExport(db, editor!.id, deviceToken);

    expect(result.deviceTokenHash).toBe(deviceTokenHash);
    expect(result.excludedPublishedEvidence).toBe(true);

    const submissionIds = result.submissions.map((s) => s.id);
    expect(submissionIds).toContain(ownSubmission!.id);
    expect(submissionIds).toContain(publishedSubmission!.id);
    expect(submissionIds).not.toContain(otherSubmission!.id);

    const ownExport = result.submissions.find((s) => s.id === ownSubmission!.id) as { drafts: Array<{ id: string }> };
    expect(ownExport.drafts.map((d) => d.id)).toContain(draftCheck!.id);

    const publishedExport = result.submissions.find((s) => s.id === publishedSubmission!.id) as { drafts: Array<{ id: string }> };
    expect(publishedExport.drafts).toHaveLength(0);

    const exportedSummaries = JSON.stringify(result.submissions);
    expect(exportedSummaries).not.toContain("published verdict that must never appear");
  });
});
