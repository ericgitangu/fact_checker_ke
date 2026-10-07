import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { getEditorQueue, listHeldChecks, rejectCheck, sweepExpiredChecks } from "../lib/editorial.js";
import { PostgresTrendingRepository } from "../repositories/postgres.js";
import { AuthService } from "../lib/auth/service.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * Gated-item terminal lifecycle (held-draft -> dismissed), exercised
 * against the REAL Postgres path (no mocks of our own DB layer —
 * CLAUDE.md "verify through the real code path"):
 *
 *   - a held draft shows in the editor queue AND reads `under_review`
 *     publicly;
 *   - the auto-expiry sweep closes an OLD held draft terminally: its
 *     submission goes `failed`, the draft row is left intact (no verdict
 *     leak), it drops out of the queue, and its public trending status
 *     flips to `dismissed`;
 *   - an editor Dismiss (`rejectCheck`) does the same and writes the
 *     review_actions + audit rows.
 */
const connectionString = requireIntegrationDatabaseUrl();

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!connectionString)("gated-item terminal lifecycle (ADR-0025 / sweep)", () => {
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

  async function seedHeldDraft(opts: { ageDays: number }): Promise<{ submissionId: string; checkId: string }> {
    const createdAt = new Date(Date.now() - opts.ageDays * DAY_MS);
    const [submission] = await db
      .insert(schema.submissions)
      .values({
        url: null,
        text: `Gated-lifecycle fixture ${randomUUID()}: viral clip claim.`,
        submittedBy: "gated-lifecycle-test",
        status: "ready",
        ingestSource: "fetch",
        viralityScore: "123.45",
        createdAt,
      })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "Held-draft summary (should never go public).",
        rating: "Unproven",
        isDraft: true,
        riskTier: "B",
        createdAt,
      })
      .returning();
    return { submissionId: submission!.id, checkId: check!.id };
  }

  async function trendingStatusFor(submissionId: string): Promise<{ status: string; checkId: string | null } | null> {
    const repo = new PostgresTrendingRepository(db);
    const items = await repo.listTrending({ limit: 200 });
    const row = items.find((i) => i.submissionId === submissionId);
    return row ? { status: row.status, checkId: row.checkId } : null;
  }

  it("auto-expiry sweep terminally closes an OLD held draft (dismissed), leaving the draft row intact", async () => {
    const { submissionId, checkId } = await seedHeldDraft({ ageDays: 30 });

    // Pre-state: in the queue + list, public status under_review.
    expect((await listHeldChecks(db)).some((c) => c.checkId === checkId)).toBe(true);
    expect((await getEditorQueue(db)).some((c) => c.checkId === checkId)).toBe(true);
    expect(await trendingStatusFor(submissionId)).toEqual({ status: "under_review", checkId: null });

    const result = await sweepExpiredChecks(db, { expiryDays: 7 });
    expect(result.expired).toBeGreaterThanOrEqual(1);

    // Submission driven to terminal `failed`; the DRAFT ROW is UNCHANGED
    // (no isDraft/publishedAt flip -> no verdict leak at /v1/checks/:id).
    const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).limit(1);
    expect(sub!.status).toBe("failed");
    const [chk] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId)).limit(1);
    expect(chk!.isDraft).toBe(true);
    expect(chk!.publishedAt).toBeNull();

    // Out of the queue/list, public status now dismissed.
    expect((await listHeldChecks(db)).some((c) => c.checkId === checkId)).toBe(false);
    expect((await getEditorQueue(db)).some((c) => c.checkId === checkId)).toBe(false);
    expect(await trendingStatusFor(submissionId)).toEqual({ status: "dismissed", checkId: null });

    // Terminal close is audit-logged (actor null, reason auto_expired).
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "check.rejected"), eq(schema.auditLog.targetId, checkId)));
    expect(audits.length).toBe(1);
    expect(audits[0]!.actorId).toBeNull();
    expect((audits[0]!.metadata as Record<string, unknown>).reason).toBe("auto_expired");
  });

  it("does NOT expire a fresh held draft (younger than the window)", async () => {
    const { submissionId, checkId } = await seedHeldDraft({ ageDays: 1 });
    await sweepExpiredChecks(db, { expiryDays: 7 });
    const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).limit(1);
    expect(sub!.status).toBe("ready");
    expect((await getEditorQueue(db)).some((c) => c.checkId === checkId)).toBe(true);
  });

  it("editor Dismiss (rejectCheck) terminally closes a held draft and records the review action", async () => {
    const { submissionId, checkId } = await seedHeldDraft({ ageDays: 0 });
    const auth = new AuthService(db);
    const reg = await auth.register(`dismiss-actor-${randomUUID()}@example.test`, "dismiss-actor-pw-123");
    if (!reg.ok) throw new Error("setup: register failed");

    const res = await rejectCheck(db, reg.value.id, checkId, "not newsworthy");
    expect(res.ok).toBe(true);

    const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).limit(1);
    expect(sub!.status).toBe("failed");
    expect((await getEditorQueue(db)).some((c) => c.checkId === checkId)).toBe(false);

    const reviews = await db.select().from(schema.reviewActions).where(eq(schema.reviewActions.checkId, checkId));
    expect(reviews.length).toBe(1);
    expect(reviews[0]!.action).toBe("reject");
    expect(reviews[0]!.actorId).toBe(reg.value.id);

    // Publicly, the editor-dismissed item reads `dismissed` (same terminal
    // signal as the sweep). Operationally it can't be re-dismissed: the
    // queue filter hides failed-submission drafts, so the editor never
    // sees it again.
    expect(await trendingStatusFor(submissionId)).toEqual({ status: "dismissed", checkId: null });
  });
});
