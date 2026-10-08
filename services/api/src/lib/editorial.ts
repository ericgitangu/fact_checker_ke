import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { EditorQueueItem } from "@fact-checker-ke/core";
import { writeOutboxEvent } from "./outbox.js";
import { writeAuditLog } from "./audit.js";
import { captureEditorCorrection } from "./flywheel.js";

export type EditorialResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

const RIGHT_OF_REPLY_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * ADR-0038 (correction to ADR-0025 §2): the editor queue is the BOUNDED
 * escalation queue — ONLY `lifecycle_state = 'editor_review'`, NOT "every
 * draft". With preliminary + awaiting_sources now materialised as autonomous
 * public threads, "every draft" would be the entire backlog and drown a solo
 * founder — the opposite of autonomy-first. Only items escalated by community
 * source-weight, virality, or an explicit editor pull reach `editor_review`.
 *
 * Order by `(virality_score DESC, last_activity_at DESC)`, both NULLS LAST so a
 * scored/recently-touched escalation ranks above an unscored/stale one (the
 * ADR's `accepted_source_weight` tie-breaker rides the Wave-2 crowdsource
 * table, which does not exist yet — see the Wave 2 marker in routes/checks.ts).
 */
export async function getEditorQueue(db: Database): Promise<EditorQueueItem[]> {
  const draftChecks = await db
    .select()
    .from(schema.checks)
    .where(eq(schema.checks.lifecycleState, "editor_review"))
    .orderBy(
      sql`${schema.checks.viralityScore} desc nulls last`,
      sql`${schema.checks.lastActivityAt} desc nulls last`,
    );

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
    // ADR-0038: the editor-approval edge is the ONLY path a named-person item
    // ever reaches `published` ([E] in the transition table — no [A] edge may).
    // Set the terminal `published` lifecycle + bump `last_activity_at` (an
    // editor touch is activity) atomically with the publish flip.
    await tx
      .update(schema.checks)
      .set({ isDraft: false, publishedAt, lifecycleState: "published", lastActivityAt: publishedAt })
      .where(eq(schema.checks.id, args.checkId));
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

export async function rejectCheck(
  db: Database,
  actorId: string,
  checkId: string,
  notes: string | null,
): Promise<EditorialResult<{ rejected: true }>> {
  const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId)).limit(1);
  if (!check) return { ok: false, error: { kind: "not_found", message: "No such check." } };

  const now = new Date();
  await db.transaction(async (tx) => {
    // ADR-0038: reject drives the check to the terminal `dismissed` lifecycle
    // ([E] editor_review → dismissed). We deliberately do NOT touch
    // isDraft/publishedAt (that pair is the published invariant every read path
    // keys off, and flipping isDraft would un-redact a named-person draft at
    // GET /v1/checks/:id); the lifecycle column is the orthogonal editorial
    // track, so a dismissed held draft stays non-public and simply reads
    // `dismissed` in the trending projection. `last_activity_at` bumped.
    await tx
      .update(schema.checks)
      .set({ lifecycleState: "dismissed", lastActivityAt: now })
      .where(eq(schema.checks.id, checkId));
    await tx.insert(schema.reviewActions).values({ checkId, actorId, action: "reject", notes, publicSafetyReason: null });
    await writeAuditLog(tx, { actorId, action: "check.rejected", targetType: "check", targetId: checkId, metadata: { notes } });
  });
  return { ok: true, value: { rejected: true } };
}

/**
 * ADR-0038 auto-expire sweep ([T] in the transition table). Transitions stale
 * NON-terminal checks to the terminal `archived_expired` and bumps
 * `last_activity_at`, writing an AUDIT entry per row (not an outbox event).
 *
 * TECH DEBT (flagged, not hidden): neither `check.archived_expired` (audit
 * action, packages/core `AuditActionSchema`) nor a `check.archived_expired`
 * OutboxEvent type exists, and `packages/core` is out of scope this wave — so
 * the audit row reuses the existing terminal-close action `check.rejected`,
 * disambiguated by `metadata.reason = "auto_expired"` + `metadata.from`
 * (an incident responder filters on the metadata, not just the action name).
 * The clean fix is a dedicated `check.archived_expired` action + outbox event
 * in a follow-up core change.
 *
 * Two TTLs, both from the stale item's `last_activity_at` (the single clock):
 *   - `preliminary` / `awaiting_sources` → `lifecycleExpiryDays` (default 7).
 *   - `editor_review` → `editorReviewExpiryDays` (default 30) — a human-owned
 *     item is not yanked at 7d.
 * `verifying` is excluded: it is a transient in-flight state, not a stalled
 * public thread. Terminal states (published/dismissed/archived_expired) and
 * rows with a null lifecycle (pre-0038 / flag-off) are never touched.
 *
 * FAIL-CLOSED / idempotent: the `in (...)` + `last_activity_at < cutoff`
 * predicates mean a re-run skips rows a prior sweep already archived (no
 * duplicate audit rows), and the per-state cutoff is computed from `now` each
 * call. One UPDATE + one audit insert per expired row inside a single
 * transaction — O(n) in the (small, daily) stale backlog; flagged rather than
 * micro-optimised so the terminal-close path stays explicit and auditable.
 */
export interface SweepExpiredLifecycleResult {
  archived: number;
}

export async function sweepExpiredLifecycle(
  db: Database,
  opts: { lifecycleExpiryDays: number; editorReviewExpiryDays: number },
): Promise<SweepExpiredLifecycleResult> {
  // Cutoffs computed DB-side via make_interval(days => N): binding a JS Date into
  // the sql`` template fails to serialize through the pg driver, and server-side
  // interval math is clock-skew-free. A null `last_activity_at` is treated as
  // never stale (coalesced to "now") — it is nullable only for legacy rows, and
  // an unclocked item must not be swept on a guess. One SELECT gathers both
  // cohorts: the shorter-TTL autonomous states and the longer-TTL editor_review.
  const stale = await db
    .select({
      id: schema.checks.id,
      lifecycleState: schema.checks.lifecycleState,
    })
    .from(schema.checks)
    .where(
      sql`${schema.checks.lifecycleState} is not null and (
        (${schema.checks.lifecycleState} in ('preliminary','awaiting_sources')
          and coalesce(${schema.checks.lastActivityAt}, now()) < now() - make_interval(days => ${opts.lifecycleExpiryDays}))
        or
        (${schema.checks.lifecycleState} = 'editor_review'
          and coalesce(${schema.checks.lastActivityAt}, now()) < now() - make_interval(days => ${opts.editorReviewExpiryDays}))
      )`,
    );

  if (stale.length === 0) return { archived: 0 };

  const archivedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.checks)
      .set({ lifecycleState: "archived_expired", lastActivityAt: archivedAt })
      .where(
        inArray(
          schema.checks.id,
          stale.map((r) => r.id),
        ),
      );
    for (const row of stale) {
      await writeAuditLog(tx, {
        actorId: null,
        // See the TECH DEBT note above: reuses `check.rejected` (terminal
        // close) disambiguated by metadata until a core action exists.
        action: "check.rejected",
        targetType: "check",
        targetId: row.id,
        metadata: { from: row.lifecycleState, reason: "auto_expired" },
      });
    }
  });
  return { archived: stale.length };
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
