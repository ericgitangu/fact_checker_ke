import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { writeAuditLog } from "./audit.js";
import { correctCheck, type EditorialResult } from "./editorial.js";

/**
 * ADR-0031 amendment (two-engine pivot) / ADR-0025 amendment, AT-0031-9,
 * AT-0025-6/7: the human role moves from blocking pre-publish approver to
 * ASYNC AUDITOR of a shrinking sample, for Tier A/B and Tier-C mode (a).
 * This module records that sampling decision and the editor's eventual
 * audit outcome — it never blocks the publish path itself (unlike
 * `editorial.ts#approveCheck`, which still gates Tier-C mode (b) and any
 * tier that failed to auto-publish via `decide_publish_policy`).
 */

export interface AsyncAuditQueueEntry {
  checkId: string;
  tier: "A" | "B" | "C";
  /** "open_question" | "plain_caveat" — see app/stages/publish_policy.py's `PublishDecision.publish_mode`. */
  publishMode: string;
  /**
   * The sampling rate in effect AT QUEUE TIME — a snapshot of
   * app/eval/calibrate.py's `compute_audit_sample_rate(...)` output,
   * computed by the pipeline (the only service that has the calibration
   * artifact) and passed through on the publish event. This module does
   * NOT recompute or hardcode a rate — AT-0031-9/AT-0025-7's "an output,
   * not a constant" is enforced by calibrate.py; this is just where the
   * value that governed THIS item's sampling decision is recorded.
   */
  sampleRateAtQueueTime: number;
}

/**
 * The actual sampling decision: draw against `sampleRateAtQueueTime` and
 * only enqueue a row when the draw falls inside it. `rand` is injectable
 * (defaults to `Math.random`) so tests can assert the rate is honoured
 * deterministically without flaky randomness.
 *
 * AT-0025-6: "An auto-published assessment is recorded into an
 * async-audit sampling queue AT A CONFIGURABLE RATE" — a rate of `1.0`
 * (the pilot default, see calibrate.py's `PILOT_AUDIT_SAMPLE_RATE`)
 * always enqueues; a rate of `0.0` never does.
 */
export async function maybeEnqueueForAsyncAudit(
  db: Database,
  entry: AsyncAuditQueueEntry,
  rand: () => number = Math.random,
): Promise<{ queued: boolean }> {
  if (rand() >= entry.sampleRateAtQueueTime) {
    return { queued: false };
  }
  await db
    .insert(schema.asyncAuditQueue)
    .values({
      checkId: entry.checkId,
      tier: entry.tier,
      publishMode: entry.publishMode,
      sampleRateAtQueueTime: entry.sampleRateAtQueueTime,
      outcome: "pending",
    })
    // A check republished through a retry, or already-queued check
    // revisited by the same caller, must not duplicate the queue row —
    // `async_audit_queue_check_id_idx` is the UNIQUE constraint this
    // relies on. Idempotent no-op on conflict (the first queue decision
    // for a check wins).
    .onConflictDoNothing({ target: schema.asyncAuditQueue.checkId });
  return { queued: true };
}

export type AuditOutcome = "confirmed" | "error_found";

/**
 * AT-0025-6: the editor's recorded disposition on a sampled item.
 * `confirmed` just updates this row. `error_found` ADDITIONALLY calls
 * `correctCheck` (a NEW `checks` row, `check.corrected`) — the audit
 * finding is never a silent edit of the original published check or of
 * this queue row's content; the queue row only ever records that an
 * audit happened and what it concluded.
 */
export async function recordAuditOutcome(
  db: Database,
  args: {
    actorId: string;
    queueId: string;
    outcome: AuditOutcome;
    notes: string | null;
    /** Required when `outcome === "error_found"` — the correction content. */
    correction?: { summary: string; rating: NonNullable<(typeof schema.checks.$inferSelect)["rating"]> };
  },
): Promise<EditorialResult<{ outcome: AuditOutcome; newCheckId: string | null }>> {
  const [row] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.id, args.queueId)).limit(1);
  if (!row) return { ok: false, error: { kind: "not_found", message: "No such async-audit queue entry." } };
  if (row.outcome !== "pending") {
    return { ok: false, error: { kind: "already_audited", message: "This queue entry already has a recorded outcome." } };
  }

  if (args.outcome === "error_found") {
    if (!args.correction) {
      return {
        ok: false,
        error: { kind: "correction_required", message: "An error_found outcome requires correction content." },
      };
    }
    const corrected = await correctCheck(db, args.actorId, row.checkId, {
      summary: args.correction.summary,
      rating: args.correction.rating,
      notes: args.notes,
    });
    if (!corrected.ok) return corrected;

    await db.transaction(async (tx) => {
      await tx
        .update(schema.asyncAuditQueue)
        .set({ outcome: "error_found", auditedBy: args.actorId, auditedAt: new Date(), notes: args.notes })
        .where(eq(schema.asyncAuditQueue.id, args.queueId));
      await writeAuditLog(tx, {
        actorId: args.actorId,
        action: "check.corrected",
        targetType: "async_audit_queue",
        targetId: args.queueId,
        metadata: { checkId: row.checkId, newCheckId: corrected.value.newCheckId },
      });
    });
    return { ok: true, value: { outcome: "error_found", newCheckId: corrected.value.newCheckId } };
  }

  await db
    .update(schema.asyncAuditQueue)
    .set({ outcome: "confirmed", auditedBy: args.actorId, auditedAt: new Date(), notes: args.notes })
    .where(eq(schema.asyncAuditQueue.id, args.queueId));
  return { ok: true, value: { outcome: "confirmed", newCheckId: null } };
}
