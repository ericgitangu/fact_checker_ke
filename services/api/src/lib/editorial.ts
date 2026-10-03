import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { EditorQueueItem } from "@fact-checker-ke/core";
import { writeOutboxEvent } from "./outbox.js";
import { writeAuditLog } from "./audit.js";
import { captureEditorCorrection } from "./flywheel.js";

export type EditorialResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

const RIGHT_OF_REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * ADR-0025 §2: the editor queue is every draft, unpublished check,
 * oldest first (FIFO matches the ADR's "sustainable throughput"
 * framing — no reordering by claim severity in this wave).
 */
export async function getEditorQueue(db: Database): Promise<EditorQueueItem[]> {
  const draftChecks = await db
    .select()
    .from(schema.checks)
    .where(and(eq(schema.checks.isDraft, true), isNull(schema.checks.publishedAt)))
    .orderBy(schema.checks.createdAt);

  const items: EditorQueueItem[] = [];
  for (const check of draftChecks) {
    const claimRows = await db.select().from(schema.claims).where(eq(schema.claims.checkId, check.id));
    items.push({
      checkId: check.id,
      submissionId: check.submissionId,
      summary: check.summary,
      rating: check.rating,
      namedPersonClaims: claimRows
        .filter((c) => c.namedPerson)
        .map((c) => ({ claimId: c.id, text: c.text, attribution: c.attribution })),
      createdAt: check.createdAt.toISOString(),
    });
  }
  return items;
}

/**
 * ADR-0025 §5 / ADR-0004 amendment #6: the human sign-off that flips a
 * claim's quote attribution from `unverified` to `confirmed`. Required
 * (per claim) before that check can be approved (AT-0004-A/B,
 * AT-0025-2).
 */
export async function confirmQuoteAttribution(
  db: Database,
  actorId: string,
  claimId: string,
): Promise<EditorialResult<{ confirmed: true }>> {
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
  if (!claim) return { ok: false, error: { kind: "not_found", message: "No such claim." } };
  if (!claim.namedPerson) {
    return { ok: false, error: { kind: "not_applicable", message: "Claim does not name a person; no attribution to confirm." } };
  }
  await db.update(schema.claims).set({ attribution: "confirmed" }).where(eq(schema.claims.id, claimId));
  void actorId; // confirmation is audit-logged at the approve step, not per-claim, to avoid one row per claim for a multi-claim check
  return { ok: true, value: { confirmed: true } };
}

export async function issueRightOfReply(
  db: Database,
  actorId: string,
  checkId: string,
  args: { namedPerson: string; contactChannel: string },
): Promise<EditorialResult<{ id: string; windowExpiresAt: string }>> {
  const now = new Date();
  const windowExpiresAt = new Date(now.getTime() + RIGHT_OF_REPLY_WINDOW_MS);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.rightOfReply)
      .values({
        checkId,
        namedPerson: args.namedPerson,
        contactChannel: args.contactChannel,
        contactAttemptAt: now,
        windowExpiresAt,
        status: "pending",
      })
      .returning();
    if (!row) throw new Error("Insert into right_of_reply returned no row");
    await writeAuditLog(tx, {
      actorId,
      action: "right_of_reply.issued",
      targetType: "check",
      targetId: checkId,
      metadata: { namedPerson: args.namedPerson, contactChannel: args.contactChannel },
    });
    return row;
  });
  return { ok: true, value: { id: result.id, windowExpiresAt: windowExpiresAt.toISOString() } };
}

export async function recordRightOfReply(
  db: Database,
  actorId: string,
  rightOfReplyId: string,
  args: { replyText: string | null },
): Promise<EditorialResult<{ status: "replied" }>> {
  const [row] = await db.select().from(schema.rightOfReply).where(eq(schema.rightOfReply.id, rightOfReplyId)).limit(1);
  if (!row) return { ok: false, error: { kind: "not_found", message: "No such right-of-reply record." } };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.rightOfReply)
      .set({ status: "replied", replyReceivedAt: new Date(), replyText: args.replyText })
      .where(eq(schema.rightOfReply.id, rightOfReplyId));
    await writeAuditLog(tx, {
      actorId,
      action: "right_of_reply.recorded",
      targetType: "check",
      targetId: row.checkId,
      metadata: { rightOfReplyId, hasReply: args.replyText !== null },
    });
  });
  return { ok: true, value: { status: "replied" } };
}

/**
 * AT-0025-1/AT-0025-3: a named-person check's right-of-reply is
 * "cleared" either because a reply was recorded, the 48h window has
 * elapsed, or an admin signed off a public-safety override with a
 * reason — anything else blocks approval.
 */
async function rightOfReplyCleared(
  db: Database,
  checkId: string,
): Promise<{ cleared: true } | { cleared: false; reason: string }> {
  const rows = await db.select().from(schema.rightOfReply).where(eq(schema.rightOfReply.checkId, checkId));
  if (rows.length === 0) {
    return { cleared: false, reason: "No right-of-reply attempt logged for a named-person draft." };
  }
  const now = Date.now();
  for (const row of rows) {
    if (row.status === "replied") continue;
    const expired = row.windowExpiresAt ? row.windowExpiresAt.getTime() <= now : false;
    if (!expired) {
      return { cleared: false, reason: `Right-of-reply window for "${row.namedPerson}" has not elapsed and no reply is recorded.` };
    }
  }
  return { cleared: true };
}

export interface ApproveArgs {
  actorId: string;
  actorRole: "editor" | "admin" | "moderator" | null;
  checkId: string;
  notes: string | null;
  /** AT-0025-3: required to skip the right-of-reply gate; admin-only. */
  publicSafetyReason?: string | null;
}

export async function approveCheck(db: Database, args: ApproveArgs): Promise<EditorialResult<{ publishedAt: string }>> {
  const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, args.checkId)).limit(1);
  if (!check) return { ok: false, error: { kind: "not_found", message: "No such check." } };
  if (!check.isDraft || check.publishedAt) {
    return { ok: false, error: { kind: "already_published", message: "Check is already published." } };
  }
  const rating = check.rating;
  if (!rating) {
    return { ok: false, error: { kind: "no_rating", message: "Check has no rating to publish." } };
  }

  const claimRows = await db.select().from(schema.claims).where(eq(schema.claims.checkId, args.checkId));
  const namedPersonClaims = claimRows.filter((c) => c.namedPerson);

  if (namedPersonClaims.length > 0) {
    // AT-0004-A/AT-0025-2: every named-person claim's quote attribution
    // must be confirmed before publish, UNLESS it was never a
    // submitter-quote claim to begin with (not_applicable).
    const stillUnverified = namedPersonClaims.filter((c) => c.attribution === "unverified");
    if (stillUnverified.length > 0) {
      return {
        ok: false,
        error: {
          kind: "attribution_unverified",
          message: `${stillUnverified.length} named-person claim(s) still have unverified quote attribution.`,
        },
      };
    }

    if (args.publicSafetyReason) {
      // AT-0025-3: skipping right-of-reply requires a non-empty reason AND admin sign-off.
      if (args.actorRole !== "admin") {
        return { ok: false, error: { kind: "forbidden", message: "Only an admin may sign off a public-safety override." } };
      }
    } else {
      const cleared = await rightOfReplyCleared(db, args.checkId);
      if (!cleared.cleared) {
        return { ok: false, error: { kind: "right_of_reply_pending", message: cleared.reason } };
      }
    }
  }

  const publishedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(schema.checks).set({ isDraft: false, publishedAt }).where(eq(schema.checks.id, args.checkId));
    await tx.insert(schema.reviewActions).values({
      checkId: args.checkId,
      actorId: args.actorId,
      action: "approve",
      notes: args.notes,
      publicSafetyReason: args.publicSafetyReason ?? null,
    });
    await writeAuditLog(tx, {
      actorId: args.actorId,
      action: "check.approved",
      targetType: "check",
      targetId: args.checkId,
      metadata: { publicSafetyOverride: Boolean(args.publicSafetyReason) },
    });
    await writeAuditLog(tx, { actorId: args.actorId, action: "check.published", targetType: "check", targetId: args.checkId });
    await writeOutboxEvent(tx, {
      aggregateType: "check",
      aggregateId: args.checkId,
      submissionId: check.submissionId,
      event: {
        event_id: randomUUID(),
        occurred_at: publishedAt.toISOString(),
        submission_id: check.submissionId,
        org_id: check.orgId,
        event_type: "check.published",
        schema_version: "v1",
        payload: { check_id: args.checkId, rating },
      },
    });
  });

  return { ok: true, value: { publishedAt: publishedAt.toISOString() } };
}

export async function rejectCheck(
  db: Database,
  actorId: string,
  checkId: string,
  notes: string | null,
): Promise<EditorialResult<{ rejected: true }>> {
  const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId)).limit(1);
  if (!check) return { ok: false, error: { kind: "not_found", message: "No such check." } };

  await db.transaction(async (tx) => {
    await tx.insert(schema.reviewActions).values({ checkId, actorId, action: "reject", notes, publicSafetyReason: null });
    await writeAuditLog(tx, { actorId, action: "check.rejected", targetType: "check", targetId: checkId, metadata: { notes } });
  });
  return { ok: true, value: { rejected: true } };
}

/**
 * ADR-0025 §6: a correction is ALWAYS additive — a new `checks` row,
 * never an UPDATE of the published verdict's rating/summary (AT-0025-4).
 * `correctedFromCheckId` chains the new row back to the one it supersedes.
 */
export async function correctCheck(
  db: Database,
  actorId: string,
  originalCheckId: string,
  args: { summary: string; rating: NonNullable<(typeof schema.checks.$inferSelect)["rating"]>; notes: string | null },
): Promise<EditorialResult<{ newCheckId: string }>> {
  const [original] = await db.select().from(schema.checks).where(eq(schema.checks.id, originalCheckId)).limit(1);
  if (!original) return { ok: false, error: { kind: "not_found", message: "No such check." } };
  if (original.isDraft || !original.publishedAt) {
    return { ok: false, error: { kind: "not_published", message: "Only a published check can be corrected." } };
  }

  const publishedAt = new Date();
  const newCheckId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.checks)
      .values({
        orgId: original.orgId,
        submissionId: original.submissionId,
        summary: args.summary,
        rating: args.rating,
        isDraft: false,
        reviewedBy: original.reviewedBy,
        correctedFromCheckId: originalCheckId,
        publishedAt,
      })
      .returning({ id: schema.checks.id });
    if (!row) throw new Error("Insert into checks (correction) returned no row");

    await tx.insert(schema.reviewActions).values({ checkId: row.id, actorId, action: "correct", notes: args.notes, publicSafetyReason: null });
    await writeAuditLog(tx, {
      actorId,
      action: "check.corrected",
      targetType: "check",
      targetId: row.id,
      metadata: { previousCheckId: originalCheckId },
    });
    // ADR-0031 AT-0031-4: every editor correction is also a labeled
    // flywheel row, in the SAME transaction (a rolled-back correction
    // produces zero flywheel rows too).
    await captureEditorCorrection(tx, {
      originalCheckId,
      newCheckId: row.id,
      actorId,
      correctedRating: args.rating,
      notes: args.notes,
    });
    await writeOutboxEvent(tx, {
      aggregateType: "check",
      aggregateId: row.id,
      submissionId: original.submissionId,
      event: {
        event_id: randomUUID(),
        occurred_at: publishedAt.toISOString(),
        submission_id: original.submissionId,
        org_id: original.orgId,
        event_type: "check.corrected",
        schema_version: "v1",
        payload: { check_id: row.id, previous_check_id: originalCheckId, rating: args.rating },
      },
    });
    return row.id;
  });

  return { ok: true, value: { newCheckId } };
}
