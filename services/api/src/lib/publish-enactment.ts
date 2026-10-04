import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { Rating } from "@fact-checker-ke/core";
import { writeAuditLog } from "./audit.js";
import { writeOutboxEvent } from "./outbox.js";
import { isAutonomousPublishFrozen } from "./publish-kill-switch.js";
import { isFetchEngineFrozen } from "./fetch-kill-switch.js";
import { maybeEnqueueForAsyncAudit } from "./async-audit.js";

/**
 * ADR-0031 amendment (two-engine pivot) / ADR-0032 (fetch) — the ONE
 * place a `services/pipeline` `/hops/verify` response's
 * `PublishDecisionPayload` (app/stages/pipeline_io.py's `VerifyResult.
 * publish`, produced by app/stages/publish.py#finalize_publish) is
 * ACTUALLY ENACTED against a `checks` row: this is the "C1 gap" closed
 * on the Python side by `finalize_publish`'s wiring into
 * `decide_publish_policy`, closed here on the TS/Postgres side.
 *
 * Three branches, matching `PublishDecision`'s three booleans 1:1
 * (app/stages/publish_policy.py):
 *
 *   1. `autoPublish === true` -> actually publish: set `isDraft=false`,
 *      `publishedAt`, emit `check.published` (with `ingestSource`
 *      provenance), and — if `queuedForAsyncAudit` — enqueue the async-
 *      audit sampling row (AT-0031-9/AT-0025-6).
 *      EXCEPT: when `ingestSource === "fetch"` and the fetch kill
 *      switch is frozen, this is REFUSED (AT-0032-6: "stops ... autonomous
 *      publishing ... within one propagation cycle") — the check is left
 *      exactly as it was (an unpublished draft) for a human, and the
 *      refusal is audit-logged distinctly from an ordinary publish.
 *   2. `requiresHumanTap === true` -> leave the check as an unpublished
 *      draft; it surfaces in the ordinary editor queue
 *      (lib/editorial.ts#getEditorQueue already selects every
 *      `isDraft && publishedAt IS NULL` row — no new queue needed).
 *   3. Neither -> same as (2): leave as an unpublished draft (the
 *      ordinary "below threshold, human gate" outcome).
 *
 * FAIL-CLOSED, defence in depth (mirrors app/stages/publish.py's own
 * fail-closed rule at THIS boundary too, not just trusting the
 * pipeline's decision blindly): a missing/blank `summary` NEVER
 * publishes, even if `decision.autoPublish` is somehow `true` — this
 * function treats that combination as a contract violation from the
 * pipeline and fails closed rather than trusting it.
 */
export interface PublishDecisionInput {
  autoPublish: boolean;
  reason: string;
  publishMode: string | null;
  queuedForAsyncAudit: boolean;
  requiresHumanTap: boolean;
}

export interface EnactPublishDecisionArgs {
  checkId: string;
  actorId: string | null;
  ingestSource: "submission" | "fetch";
  rating: Rating;
  /** The rendered summary text the decision was made against — see the
   * fail-closed rule above. */
  summary: string | null;
  riskTier: "A" | "B" | "C";
  decision: PublishDecisionInput;
  /** A snapshot of app/eval/calibrate.py's `compute_audit_sample_rate`
   * output at decision time — required only when `decision.
   * queuedForAsyncAudit` is true (see async-audit.ts's own docblock on
   * why this is never recomputed/hardcoded here). */
  sampleRateAtQueueTime?: number;
}

export type EnactPublishDecisionOutcome =
  | { kind: "published"; publishedAt: string; queuedForAsyncAudit: boolean }
  | { kind: "left_pending"; reason: string }
  | { kind: "blocked_by_fetch_kill_switch"; reason: string }
  | { kind: "fail_closed_no_summary" }
  | { kind: "not_found" };

export async function enactPublishDecision(
  db: Database,
  args: EnactPublishDecisionArgs,
): Promise<EnactPublishDecisionOutcome> {
  const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, args.checkId)).limit(1);
  if (!check) return { kind: "not_found" };

  // Idempotent no-op: a retry of an already-enacted decision must not
  // re-publish or re-audit-log.
  if (check.publishedAt) {
    return { kind: "published", publishedAt: check.publishedAt.toISOString(), queuedForAsyncAudit: false };
  }

  if (!args.decision.autoPublish) {
    // Branches 2/3 above: nothing to do — the draft stays in the
    // ordinary editor queue. Not an error; just a non-publish.
    return { kind: "left_pending", reason: args.decision.reason };
  }

  // Fail-closed, defence in depth (see module docblock).
  if (args.summary === null || args.summary.trim().length === 0) {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: args.actorId,
        action: "check.auto_publish_blocked",
        targetType: "check",
        targetId: args.checkId,
        metadata: { reason: "fail-closed: no rendered summary available at enactment time", ingestSource: args.ingestSource },
      });
    });
    return { kind: "fail_closed_no_summary" };
  }

  // AT-0031-10: the global autonomous-publish kill switch, honoured for
  // EVERY ingest source (not just fetch) — same read-fresh-every-call
  // discipline as the Python side.
  if (await isAutonomousPublishFrozen(db)) {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: args.actorId,
        action: "check.auto_publish_blocked",
        targetType: "check",
        targetId: args.checkId,
        metadata: { reason: "global autonomous-publish kill switch is frozen", ingestSource: args.ingestSource },
      });
    });
    return { kind: "blocked_by_fetch_kill_switch", reason: "global autonomous-publish kill switch is frozen" };
  }

  // AT-0032-6: the fetch-engine kill switch additionally halts
  // AUTONOMOUS PUBLISHING of fetch-sourced items specifically, even
  // when the global switch above is live — the submission engine's
  // publishing is UNAFFECTED by this check.
  if (args.ingestSource === "fetch" && (await isFetchEngineFrozen(db))) {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: args.actorId,
        action: "check.auto_publish_blocked",
        targetType: "check",
        targetId: args.checkId,
        metadata: { reason: "fetch engine kill switch is frozen", ingestSource: args.ingestSource },
      });
    });
    return { kind: "blocked_by_fetch_kill_switch", reason: "fetch engine kill switch is frozen" };
  }

  const publishedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.checks)
      .set({ isDraft: false, publishedAt, rating: args.rating, ingestSource: args.ingestSource })
      .where(eq(schema.checks.id, args.checkId));

    await writeAuditLog(tx, {
      actorId: args.actorId,
      action: "check.published",
      targetType: "check",
      targetId: args.checkId,
      metadata: {
        auto: true,
        publishMode: args.decision.publishMode,
        riskTier: args.riskTier,
        ingestSource: args.ingestSource,
      },
    });

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
        // ADR-0032/AT-0032-6: "every published fetched assessment
        // carries ingest_source: 'fetch' provenance" — carried from
        // the owning submission/check row, not re-derived.
        payload: { check_id: args.checkId, rating: args.rating, ingest_source: args.ingestSource },
      },
    });
  });

  if (args.decision.queuedForAsyncAudit) {
    await maybeEnqueueForAsyncAudit(db, {
      checkId: args.checkId,
      tier: args.riskTier,
      publishMode: args.decision.publishMode ?? "plain_caveat",
      sampleRateAtQueueTime: args.sampleRateAtQueueTime ?? 1.0,
    });
  }

  return { kind: "published", publishedAt: publishedAt.toISOString(), queuedForAsyncAudit: args.decision.queuedForAsyncAudit };
}
