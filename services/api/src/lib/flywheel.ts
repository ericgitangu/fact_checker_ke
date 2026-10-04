import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";

export type EditorialResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

/**
 * ADR-0031 "data flywheel" (AT-0031-4): every editor correction becomes a
 * labeled training/eval row, append-only (never updated/deleted — same
 * discipline as `review_actions`). Always called from WITHIN the same
 * transaction as the correction it records (see
 * services/api/src/lib/editorial.ts#correctCheck) so a rolled-back
 * correction produces zero flywheel rows too.
 */
export async function captureEditorCorrection(
  tx: Database,
  args: {
    originalCheckId: string;
    newCheckId: string;
    actorId: string;
    correctedRating: string;
    notes: string | null;
  },
): Promise<void> {
  await tx.insert(schema.trainingEvalLabels).values({
    checkId: args.newCheckId,
    source: "editor_correction",
    actorRef: args.actorId,
    label: {
      previousCheckId: args.originalCheckId,
      correctedRating: args.correctedRating,
      notes: args.notes,
    },
  });
}

/**
 * ADR-0031 (AT-0031-4): a reader's post-publish agree/dispute signal,
 * captured as a labeled flywheel row. `actorRef` is the hashed device
 * identity (ADR-0020 pattern, same as `comments.authorDeviceHash`) —
 * never the raw device token.
 *
 * ADR-0031 review finding (data-lifecycle hardening pass): a single
 * device/editor could otherwise flood `training_eval_labels` with
 * duplicate rows by resubmitting a signal on the same check (double-tap,
 * client retry, or deliberate weighting of the flywheel's eval set).
 * `migrations/0011` adds a UNIQUE index on `(check_id, actor_ref)`; this
 * now upserts on that constraint — **last-signal-wins**: a later
 * agree/dispute from the same actor on the same check overwrites the
 * earlier one's `source`/`label`/`createdAt` rather than appending a new
 * row. This intentionally does NOT distinguish "same actor changed their
 * mind" from "same actor replayed the request" — both collapse to one
 * row, which is the correct outcome for a labeled-dataset-integrity
 * control (one vote per actor per check), even though it means a
 * genuine mind-change loses the history of the original signal. If a
 * future need arises to analyze signal *changes* over time, that is an
 * append-only history table, not a mutation of this uniqueness
 * constraint.
 */
export async function captureUserSignal(
  db: Database,
  args: {
    checkId: string;
    deviceTokenHash: string;
    signal: "agree" | "dispute";
    reason: string | null;
  },
): Promise<EditorialResult<{ captured: true }>> {
  const [check] = await db
    .select({ id: schema.checks.id })
    .from(schema.checks)
    .where(eq(schema.checks.id, args.checkId))
    .limit(1);
  if (!check) {
    return { ok: false, error: { kind: "not_found", message: `Check ${args.checkId} not found.` } };
  }

  await db
    .insert(schema.trainingEvalLabels)
    .values({
      checkId: args.checkId,
      source: args.signal === "agree" ? "user_agree" : "user_dispute",
      actorRef: args.deviceTokenHash,
      label: { signal: args.signal, reason: args.reason },
    })
    .onConflictDoUpdate({
      target: [schema.trainingEvalLabels.checkId, schema.trainingEvalLabels.actorRef],
      set: {
        source: args.signal === "agree" ? "user_agree" : "user_dispute",
        label: { signal: args.signal, reason: args.reason },
        createdAt: new Date(),
      },
    });

  return { ok: true, value: { captured: true } };
}
