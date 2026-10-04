import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { recordFunnelPost } from "../lib/creator-funnel.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0030-1 (ADR-0030): "Every row in the funnel-content audit table
 * references a check_id whose published_at timestamp is earlier than
 * the funnel post's posted_at." Exercises the REAL write path
 * (`recordFunnelPost`, services/api/src/lib/creator-funnel.ts) against a
 * real Postgres instance, including the database-level CHECK constraint
 * added in migration 0011 as the second line of defense.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0030 creator-funnel audit trail (AT-0030-1, integration)", () => {
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

  async function makeAdminAndPublishedCheck(publishedAt: Date) {
    const [admin] = await db
      .insert(schema.users)
      .values({ email: `founder-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `funnel-${randomUUID()}` })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "A published check the funnel will reference.",
        rating: "True",
        isDraft: false,
        publishedAt,
      })
      .returning();
    return { admin: admin!, check: check! };
  }

  it("records a funnel post against an already-published check, publishedAt earlier than postedAt", async () => {
    const publishedAt = new Date(Date.now() - 60_000);
    const { admin, check } = await makeAdminAndPublishedCheck(publishedAt);

    const result = await recordFunnelPost(db, {
      actorId: admin.id,
      checkId: check.id,
      funnelPostUrl: "https://www.youtube.com/watch?v=abc123",
      postedAt: new Date(),
      platform: "youtube",
      aiDisclosed: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const rows = await db.select().from(schema.funnelAuditLog).where(eq(schema.funnelAuditLog.id, result.value.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.checkId).toBe(check.id);
    expect(rows[0]!.postedAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.publishedAt.getTime());
    expect(rows[0]!.aiDisclosed).toBe(true);
  });

  it("rejects a funnel post that predates the check's publication (source-restriction firewall)", async () => {
    const publishedAt = new Date();
    const { admin, check } = await makeAdminAndPublishedCheck(publishedAt);

    const result = await recordFunnelPost(db, {
      actorId: admin.id,
      checkId: check.id,
      funnelPostUrl: "https://www.tiktok.com/@founder/video/123",
      postedAt: new Date(publishedAt.getTime() - 60_000),
      platform: "tiktok",
      aiDisclosed: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("invalid_timing");

    const rows = await db.select().from(schema.funnelAuditLog).where(eq(schema.funnelAuditLog.checkId, check.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects a funnel post referencing a check with no published_at yet (draft)", async () => {
    const [admin] = await db
      .insert(schema.users)
      .values({ email: `founder-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `funnel-draft-${randomUUID()}` })
      .returning();
    const [draftCheck] = await db
      .insert(schema.checks)
      .values({ submissionId: submission!.id, summary: "An unpublished draft.", isDraft: true })
      .returning();

    const result = await recordFunnelPost(db, {
      actorId: admin!.id,
      checkId: draftCheck!.id,
      funnelPostUrl: "https://www.youtube.com/watch?v=draft",
      postedAt: new Date(),
      platform: "youtube",
      aiDisclosed: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("not_published");
  });
});
