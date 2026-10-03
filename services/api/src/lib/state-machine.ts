import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { SUBMISSION_STATUS_TRANSITIONS, type SubmissionStatus } from "@fact-checker-ke/core";

export type AdvanceOutcome =
  | { outcome: "advanced" }
  | { outcome: "stale_or_duplicate" }
  | { outcome: "invalid_transition" };

/**
 * ADR-0017 §3: "Each handler advances state with a conditional update
 * ... Zero rows updated means stale or duplicate, so the handler acks
 * and stops." Rejects a transition that isn't in the ADR's adjacency
 * map (packages/core's `SUBMISSION_STATUS_TRANSITIONS`) before issuing
 * any SQL, so a coding mistake can't silently skip a hop.
 *
 * Callers pass the transaction-scoped `tx` so this participates in the
 * same commit as the outbox/inbox/submission_events writes.
 */
export async function advanceSubmissionStatus(
  tx: Database,
  args: { submissionId: string; from: SubmissionStatus; to: SubmissionStatus },
): Promise<AdvanceOutcome> {
  if (!SUBMISSION_STATUS_TRANSITIONS[args.from].includes(args.to)) {
    return { outcome: "invalid_transition" };
  }

  const result = await tx
    .update(schema.submissions)
    .set({ status: args.to, updatedAt: new Date() })
    .where(and(eq(schema.submissions.id, args.submissionId), eq(schema.submissions.status, args.from)))
    .returning({ id: schema.submissions.id });

  return result.length > 0 ? { outcome: "advanced" } : { outcome: "stale_or_duplicate" };
}
