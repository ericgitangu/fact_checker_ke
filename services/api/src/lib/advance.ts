import { schema, type Database } from "@fact-checker-ke/db";
import type { OutboxEvent, SubmissionStatus } from "@fact-checker-ke/core";
import { advanceSubmissionStatus } from "./state-machine.js";

export type AdvanceWithInboxResult =
  | { outcome: "duplicate_message" }
  | { outcome: "stale_or_duplicate" }
  | { outcome: "invalid_transition" }
  | { outcome: "advanced"; outboxRowId: string | null; event: OutboxEvent | null };

/**
 * ADR-0017 §2 (inbox) + §3 (state machine) + §5 (submission_events
 * replay log), all in ONE transaction — this is the "internal handler
 * endpoints ... record hop completion" path: writes the inbox row,
 * the conditional state transition, and (if the transition carries an
 * event) the outbox + submission_events rows, atomically.
 *
 * `event` is optional because not every valid transition in
 * `SUBMISSION_STATUS_TRANSITIONS` has a corresponding entry in
 * packages/core's five event types (e.g. `analyzed -> verifying` is a
 * pure state marker, nothing in ADR-0017 §5's event list announces
 * "verification started").
 */
export async function advanceWithInbox(
  db: Database,
  args: {
    messageId: string;
    handler: string;
    submissionId: string;
    from: SubmissionStatus;
    to: SubmissionStatus;
    event: OutboxEvent | null;
  },
): Promise<AdvanceWithInboxResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.processedMessages)
      .values({ messageId: args.messageId, handler: args.handler })
      .onConflictDoNothing({
        target: [schema.processedMessages.messageId, schema.processedMessages.handler],
      })
      .returning({ messageId: schema.processedMessages.messageId });

    if (inserted.length === 0) {
      // Duplicate QStash delivery of a message we already processed —
      // ack without re-running anything (ADR-0017 §2).
      return { outcome: "duplicate_message" };
    }

    const advance = await advanceSubmissionStatus(tx, {
      submissionId: args.submissionId,
      from: args.from,
      to: args.to,
    });

    if (advance.outcome === "invalid_transition") {
      return { outcome: "invalid_transition" };
    }
    if (advance.outcome === "stale_or_duplicate") {
      return { outcome: "stale_or_duplicate" };
    }

    if (!args.event) {
      return { outcome: "advanced", outboxRowId: null, event: null };
    }

    const [outboxRow] = await tx
      .insert(schema.outbox)
      .values({
        aggregateType: "submission",
        aggregateId: args.submissionId,
        eventType: args.event.event_type,
        payload: args.event,
      })
      .returning({ id: schema.outbox.id });

    await tx.insert(schema.submissionEvents).values({
      submissionId: args.submissionId,
      eventId: args.event.event_id,
      eventType: args.event.event_type,
      payload: args.event,
    });

    return { outcome: "advanced", outboxRowId: outboxRow?.id ?? null, event: args.event };
  });
}
