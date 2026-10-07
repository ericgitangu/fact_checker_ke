import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { EditorQueueItem } from "@fact-checker-ke/core";
import { writeOutboxEvent } from "./outbox.js";
import { writeAuditLog } from "./audit.js";
import { captureEditorCorrection } from "./flywheel.js";

export type EditorialResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

const RIGHT_OF_REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * A "held draft" is `checks.isDraft && publishedAt IS NULL`, AND whose
 * owning submission has NOT yet been driven to its terminal `failed`
 * status. That last clause is what makes a dismissal (an editor Dismiss
 * or the auto-expiry sweep) actually REMOVE an item from the queue:
 * neither flips `isDraft`/`publishedAt` (that pair means "published" —
 * see `applyCheckDismissal`'s docblock for why we can't overload it), so
 * the only durable "this draft is terminally closed" signal available
 * without a schema change is the owning submission's `failed` status.
 * The predicate is spelled out inline in each of the three queries below
 * (editor queue, held-check list, expiry sweep) so each reads as a plain
 * Drizzle `where`.
 *
 * ADR-0025 §2: the editor queue is every draft, unpublished check whose
 * submission is not terminally closed, oldest first (FIFO matches the
 * ADR's "sustainable throughput" framing — no reordering by claim
 * severity in this wave). The `submissions` join + `status != 'failed'`
 * filter is what drops a dismissed/auto-expired draft out of the queue
 * (see `applyCheckDismissal`).
 */
export async function getEditorQueue(db: Database): Promise<EditorQueueItem[]> {
  const draftChecks = await db
    .select({
      id: schema.checks.id,
      submissionId: schema.checks.submissionId,
      summary: schema.checks.summary,
      rating: schema.checks.rating,
      createdAt: schema.checks.createdAt,
    })
    .from(schema.checks)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.checks.submissionId))
    .where(
      and(
        eq(schema.checks.isDraft, true),
        isNull(schema.checks.publishedAt),
        ne(schema.submissions.status, "failed"),
      ),
    )
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
 * The richer sibling of `getEditorQueue` for the minimal editor-review
 * UI (`apps/web/app/editor`): the same held-draft set, but carrying the
 * ADR-0031 fields the review surface ranks/triages by (`riskTier`,
 * `viralityScore`) and NO per-claim fan-out (the list view needs a row
 * per check, not its named-person claim breakdown — that's the detail
 * view's job). Deliberately NOT folded into `EditorQueueItem`
 * (packages/core) so the shared type and its other consumers are
 * untouched; this shape is local to the API read model.
 */
export interface HeldCheckListItem {
  checkId: string;
  submissionId: string;
  summary: string;
  rating: (typeof schema.checks.$inferSelect)["rating"];
  riskTier: (typeof schema.checks.$inferSelect)["riskTier"];
  viralityScore: number | null;
  createdAt: string;
}

export async function listHeldChecks(db: Database): Promise<HeldCheckListItem[]> {
  const rows = await db
    .select({
      checkId: schema.checks.id,
      submissionId: schema.checks.submissionId,
      summary: schema.checks.summary,
      rating: schema.checks.rating,
      riskTier: schema.checks.riskTier,
      viralityScore: schema.checks.viralityScore,
      createdAt: schema.checks.createdAt,
    })
    .from(schema.checks)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.checks.submissionId))
    .where(
      and(
        eq(schema.checks.isDraft, true),
        isNull(schema.checks.publishedAt),
        ne(schema.submissions.status, "failed"),
      ),
    )
    .orderBy(schema.checks.createdAt);

  return rows.map((r) => ({
    checkId: r.checkId,
    submissionId: r.submissionId,
    summary: r.summary,
    rating: r.rating,
    riskTier: r.riskTier,
    // `virality_score` is a Postgres numeric -> string over the wire (same
    // Number() coercion the feed/trending repositories apply).
    viralityScore: r.viralityScore === null ? null : Number(r.viralityScore),
    createdAt: r.createdAt.toISOString(),
  }));
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
        // ADR-0032 (two-engine pivot): a human-approved publish is
        // always the submission engine's provenance — this editor
        // pathway never handles a fetch-sourced draft (see
        // services/api/src/lib/publish-enactment.ts for that path).
        payload: { check_id: args.checkId, rating, ingest_source: "submission" },
      },
    });
  });

  return { ok: true, value: { publishedAt: publishedAt.toISOString() } };
}

/**
 * The ONE terminal-close transition for a held draft that will never be
 * published — shared by an editor's explicit Dismiss (`rejectCheck`,
 * actor = the signed-in editor) and the auto-expiry sweep
 * (`sweepExpiredChecks`, actor = null, no human). Must run inside a
 * caller-supplied transaction (`tx`).
 *
 * Terminal LEVER: it drives the OWNING SUBMISSION to `failed` — the only
 * terminal value the submission status enum has — and deliberately does
 * NOT touch `checks.isDraft`/`publishedAt`. Rationale:
 *   - `isDraft=false && publishedAt IS NOT NULL` is THE "published"
 *     invariant every read path keys off (feed, trending, repositories).
 *     Flipping `isDraft=false` with a null `publishedAt` would also
 *     un-redact a named-person draft at `GET /v1/checks/:id`
 *     (routes/checks.ts gates the rating redaction on `check.isDraft`),
 *     leaking a verdict that was never published. So the draft row is
 *     left exactly as it is.
 *   - Setting the submission `failed` instead (a) drops the draft from
 *     the editor queue (getEditorQueue / listHeldChecks exclude
 *     `submissions.status = 'failed'`) and (b) flips the item's PUBLIC
 *     trending status `under_review -> dismissed`
 *     (lib/trending-status.ts: a failed submission now outranks a held
 *     draft).
 *
 * This is an out-of-band ADMIN transition: ADR-0017's state machine
 * (`SUBMISSION_STATUS_TRANSITIONS`, where `ready: []`) forbids
 * `ready -> failed` as a PIPELINE hop, but a human Dismiss / the expiry
 * sweep is not a pipeline hop, so it writes the status directly rather
 * than through `advanceWithInbox`.
 *
 * TECH DEBT (flagged, not hidden): the clean fix is a dedicated terminal
 * state on `checks` itself (e.g. a `checks.status` enum with a
 * `dismissed`/`expired` value) rather than overloading the owning
 * submission's `failed`. That needs a schema migration (packages/db),
 * which is out of this change's scope — see the handoff note. The
 * overload's observable cost: a user-submitted (non-fetch) gated draft
 * that expires shows `failed` on its submission tracker, which reads as
 * "we couldn't process it" rather than "closed without a verdict".
 */
async function applyCheckDismissal(
  tx: Database,
  args: { checkId: string; submissionId: string; actorId: string | null; notes: string | null; reason: string },
): Promise<void> {
  await tx
    .update(schema.submissions)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(schema.submissions.id, args.submissionId));

  // `review_actions.actor_id` is NOT NULL + FK to users, so the sweep
  // (no human actor) records its terminal close in the audit log only;
  // an editor Dismiss additionally writes the review_actions row.
  if (args.actorId) {
    await tx.insert(schema.reviewActions).values({
      checkId: args.checkId,
      actorId: args.actorId,
      action: "reject",
      notes: args.notes,
      publicSafetyReason: null,
    });
  }
  await writeAuditLog(tx, {
    actorId: args.actorId,
    action: "check.rejected",
    targetType: "check",
    targetId: args.checkId,
    metadata: { reason: args.reason, ...(args.notes ? { notes: args.notes } : {}) },
  });
}

/**
 * Editor "Dismiss": terminally close a held draft (see
 * `applyCheckDismissal`). Only a held draft can be dismissed — a
 * published check is immutable (corrections are additive, `correctCheck`).
 */
export async function rejectCheck(
  db: Database,
  actorId: string,
  checkId: string,
  notes: string | null,
): Promise<EditorialResult<{ rejected: true }>> {
  const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId)).limit(1);
  if (!check) return { ok: false, error: { kind: "not_found", message: "No such check." } };
  if (!check.isDraft || check.publishedAt) {
    return { ok: false, error: { kind: "already_published", message: "Only a held draft can be dismissed." } };
  }

  await db.transaction(async (tx) => {
    await applyCheckDismissal(tx, {
      checkId,
      submissionId: check.submissionId,
      actorId,
      notes,
      reason: "editor_dismiss",
    });
  });
  return { ok: true, value: { rejected: true } };
}

export interface SweepExpiredResult {
  expired: number;
}

/**
 * Auto-expire sweep (ADR gated-item lifecycle): terminally closes every
 * held draft older than `expiryDays` whose owning submission is not
 * already `failed`, so gated named-person/political items that no editor
 * ever actioned stop piling up in `under_review` forever. Idempotent:
 * the `status != 'failed'` filter means a re-run skips rows a prior
 * sweep already closed (no duplicate audit rows).
 *
 * Intended to be driven by a QStash cron hitting
 * `POST /internal/checks/sweep-expired` (routes/internal.ts) — the
 * schedule itself is created out-of-band, same no-always-on-worker
 * policy as the outbox/retention sweeps (ADR-0017/0021).
 *
 * Performance: one UPDATE + (optionally) one audit insert per expired
 * row inside a single transaction — O(n) in the number of expired
 * drafts, which for a daily sweep of a human-review backlog is small.
 * Flagged rather than micro-optimised to a bulk statement so the
 * terminal-close path stays identical (one shared `applyCheckDismissal`)
 * to the editor Dismiss.
 */
export async function sweepExpiredChecks(db: Database, opts: { expiryDays: number }): Promise<SweepExpiredResult> {
  const cutoff = new Date(Date.now() - opts.expiryDays * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ checkId: schema.checks.id, submissionId: schema.checks.submissionId })
    .from(schema.checks)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.checks.submissionId))
    .where(
      and(
        eq(schema.checks.isDraft, true),
        isNull(schema.checks.publishedAt),
        lt(schema.checks.createdAt, cutoff),
        ne(schema.submissions.status, "failed"),
      ),
    );

  if (expired.length === 0) return { expired: 0 };

  await db.transaction(async (tx) => {
    for (const row of expired) {
      await applyCheckDismissal(tx, {
        checkId: row.checkId,
        submissionId: row.submissionId,
        actorId: null,
        notes: null,
        reason: "auto_expired",
      });
    }
  });
  return { expired: expired.length };
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
