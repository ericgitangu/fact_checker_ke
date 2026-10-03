import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { hashDeviceToken } from "./device-token.js";
import { writeAuditLog } from "./audit.js";
import { FakeObjectionableContentScorer } from "./moderation-filter.js";
import type { ObjectionableContentScorer } from "@fact-checker-ke/core";

export type ModerationResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

/** ADR-0024 §3: three reports from three distinct identities auto-hides a comment. */
const AUTO_HIDE_REPORT_THRESHOLD = 3;

/**
 * ADR-0024 §8: the primary gate is the demonstration's own `status`
 * ('ongoing' means live protest, comments off entirely) -- `commentsEnabled`
 * is a reserved override column for a later "re-enable before conclusion"
 * exception and does NOT currently loosen the gate (see schema.ts's
 * docblock on `demonstrations.commentsEnabled`).
 */
export function commentsAllowedForDemonstration(demonstration: { status: string } | null): boolean {
  if (!demonstration) return true;
  return demonstration.status !== "ongoing";
}

export async function postComment(
  db: Database,
  args: { checkId: string; authorDeviceToken: string; body: string },
  scorer: ObjectionableContentScorer = new FakeObjectionableContentScorer(),
): Promise<ModerationResult<{ id: string; status: string }>> {
  const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, args.checkId)).limit(1);
  if (!check) return { ok: false, error: { kind: "not_found", message: "No such check." } };

  // SEC-2 (security-hardening finding #2, 2026-10-04): ADR-0024 §1 scopes
  // comments to "published checks only" -- a still-draft check (shown to
  // its submitter as evidence/sources-only, `rating: null`, per
  // AT-0004-A/B) must never accept a public comment, regardless of its
  // demonstration/ongoing-event state below.
  if (check.isDraft || !check.publishedAt) {
    return { ok: false, error: { kind: "check_not_published", message: "Comments are only allowed on published checks." } };
  }

  if (check.demonstrationId) {
    const [demonstration] = await db
      .select({ status: schema.demonstrations.status })
      .from(schema.demonstrations)
      .where(eq(schema.demonstrations.id, check.demonstrationId))
      .limit(1);
    if (!commentsAllowedForDemonstration(demonstration ?? null)) {
      return {
        ok: false,
        error: { kind: "comments_disabled_ongoing_event", message: "Comments are disabled while this protest event is ongoing." },
      };
    }
  }

  const { flagged } = await scorer.score(args.body);
  const authorDeviceHash = hashDeviceToken(args.authorDeviceToken);

  const [row] = await db
    .insert(schema.comments)
    .values({
      checkId: args.checkId,
      authorDeviceHash,
      body: args.body,
      status: flagged ? "pending" : "visible",
    })
    .returning({ id: schema.comments.id, status: schema.comments.status });
  if (!row) throw new Error("Insert into comments returned no row");
  return { ok: true, value: row };
}

export async function reportComment(
  db: Database,
  commentId: string,
  reporterDeviceToken: string,
): Promise<ModerationResult<{ reportCount: number; autoHidden: boolean }>> {
  const reporterDeviceHash = hashDeviceToken(reporterDeviceToken);
  const [comment] = await db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).limit(1);
  if (!comment) return { ok: false, error: { kind: "not_found", message: "No such comment." } };

  const inserted = await db
    .insert(schema.commentReports)
    .values({ commentId, reporterDeviceHash })
    .onConflictDoNothing({ target: [schema.commentReports.commentId, schema.commentReports.reporterDeviceHash] })
    .returning({ id: schema.commentReports.id });

  // AT-0024-2: a second report from the SAME device identity is a no-op
  // (unique index did nothing) -- report count must not double-count it.
  if (inserted.length === 0) {
    return { ok: true, value: { reportCount: comment.reportCount, autoHidden: comment.status === "hidden" } };
  }

  const distinctReports = await db.select().from(schema.commentReports).where(eq(schema.commentReports.commentId, commentId));
  const reportCount = distinctReports.length;
  const autoHide = reportCount >= AUTO_HIDE_REPORT_THRESHOLD && comment.status !== "hidden";

  await db.transaction(async (tx) => {
    await tx.update(schema.comments).set({ reportCount }).where(eq(schema.comments.id, commentId));
    if (autoHide) {
      await tx.update(schema.comments).set({ status: "hidden" }).where(eq(schema.comments.id, commentId));
      await writeAuditLog(tx, {
        actorId: null,
        action: "comment.auto_hidden",
        targetType: "comment",
        targetId: commentId,
        metadata: { reportCount },
      });
    }
  });

  return { ok: true, value: { reportCount, autoHidden: autoHide } };
}

export async function blockCommenter(
  db: Database,
  blockerDeviceToken: string,
  blockedDeviceToken: string,
): Promise<ModerationResult<{ blocked: true }>> {
  const blockerDeviceHash = hashDeviceToken(blockerDeviceToken);
  const blockedDeviceHash = hashDeviceToken(blockedDeviceToken);
  await db
    .insert(schema.commentBlocks)
    .values({ blockerDeviceHash, blockedDeviceHash })
    .onConflictDoNothing({ target: [schema.commentBlocks.blockerDeviceHash, schema.commentBlocks.blockedDeviceHash] });
  return { ok: true, value: { blocked: true } };
}

/**
 * Reader-side view: hides `hidden`/`rejected`/`pending`(not-author)
 * comments and anything from a device the reader has blocked (ADR-0024
 * §4 -- client-side-equivalent filtering done server-side here since
 * the reader's block list and device identity are both known server-side).
 */
export async function listVisibleComments(
  db: Database,
  checkId: string,
  readerDeviceToken: string | null,
): Promise<Array<{ id: string; body: string; createdAt: string }>> {
  const rows = await db.select().from(schema.comments).where(and(eq(schema.comments.checkId, checkId), eq(schema.comments.status, "visible")));

  const readerDeviceHash = readerDeviceToken ? hashDeviceToken(readerDeviceToken) : null;
  const blocked = readerDeviceHash
    ? new Set(
        (await db.select().from(schema.commentBlocks).where(eq(schema.commentBlocks.blockerDeviceHash, readerDeviceHash))).map(
          (b) => b.blockedDeviceHash,
        ),
      )
    : new Set<string>();

  return rows
    .filter((r) => !blocked.has(r.authorDeviceHash))
    .map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt.toISOString() }));
}

export async function moderateComment(
  db: Database,
  actorId: string,
  commentId: string,
  decision: "release" | "reject" | "hide",
): Promise<ModerationResult<{ status: string }>> {
  const [comment] = await db.select().from(schema.comments).where(eq(schema.comments.id, commentId)).limit(1);
  if (!comment) return { ok: false, error: { kind: "not_found", message: "No such comment." } };

  const status = decision === "release" ? "visible" : decision === "reject" ? "rejected" : "hidden";
  const action = decision === "release" ? "comment.released" : decision === "reject" ? "comment.rejected" : "comment.hidden";

  await db.transaction(async (tx) => {
    await tx.update(schema.comments).set({ status }).where(eq(schema.comments.id, commentId));
    await writeAuditLog(tx, { actorId, action, targetType: "comment", targetId: commentId });
  });
  return { ok: true, value: { status } };
}

export async function getModerationQueue(db: Database): Promise<Array<{ id: string; checkId: string; body: string; reportCount: number }>> {
  const rows = await db.select().from(schema.comments).where(eq(schema.comments.status, "pending"));
  return rows.map((r) => ({ id: r.id, checkId: r.checkId, body: r.body, reportCount: r.reportCount }));
}
