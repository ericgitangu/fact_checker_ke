import { sql } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { OutboxEvent } from "@fact-checker-ke/core";
import type { Publisher } from "./publisher.js";

/**
 * Inserts the outbox row AND the submission_events replay-log row for
 * `event`, in the CALLER's transaction (ADR-0017 §1: "every state change
 * and the event announcing it are written in one Postgres transaction").
 * Callers pass a `tx` (the transaction-scoped db handle from
 * `db.transaction(async (tx) => ...)`), never the top-level `db`.
 */
export async function writeOutboxEvent(
  tx: Database,
  args: { aggregateType: string; aggregateId: string; submissionId: string; event: OutboxEvent },
): Promise<void> {
  await tx.insert(schema.outbox).values({
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.event.event_type,
    payload: args.event,
  });
  await tx.insert(schema.submissionEvents).values({
    submissionId: args.submissionId,
    eventId: args.event.event_id,
    eventType: args.event.event_type,
    payload: args.event,
  });
}

type OutboxRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

export interface DrainResult {
  /** Rows selected this pass (locked, published, and marked). */
  drained: number;
  /** Rows that failed to publish and were left unpublished for the next pass. */
  failed: number;
}

/**
 * The ADR-0017 §1 relay/sweeper: the SAME code path runs inline (right
 * after a producer's commit, BEFORE the HTTP response per the red-team
 * Amendment #3) and from the `POST /internal/outbox/drain` sweeper.
 *
 * `SELECT ... FOR UPDATE SKIP LOCKED` is held for the duration of this
 * function so two concurrent relays never publish the same row twice —
 * this is the one place in the codebase that deliberately holds a
 * transaction across an external call, because the call is a single
 * fast HTTP POST to QStash (sub-second), not the LLM/Fact-Check-API
 * calls ADR-0017 §3 warns against holding a transaction across. `limit`
 * bounds how long the lock window can get under pathological latency.
 */
export async function drainOutbox(
  db: Database,
  publisher: Publisher,
  targetUrl: string,
  limit = 25,
): Promise<DrainResult> {
  let drained = 0;
  let failed = 0;

  await db.transaction(async (tx) => {
    // drizzle-orm's postgres-js `tx.execute()` resolves to the row
    // array directly (NOT a node-postgres-style `{rows: [...]}`
    // wrapper) — verified empirically against a real Postgres while
    // building this; the `{rows}` shape was wrong and would have
    // thrown "rows is not iterable" at runtime, never caught by a unit
    // test with a mocked db.
    const result = (await tx.execute(sql`
      SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts
      FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `)) as unknown as OutboxRow[];

    for (const row of result) {
      try {
        await publisher.publish({
          url: targetUrl,
          body: row.payload,
          deduplicationId: row.id,
        });
        await tx.execute(sql`
          UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ${row.id}
        `);
        drained += 1;
      } catch {
        // Typed-error distinction (transient vs permanent) belongs to
        // the pipeline hop handlers per ADR-0017 §4; the relay itself
        // only needs to know "didn't publish, bump attempts, try again
        // next sweep" — it never deletes or poisons an outbox row.
        await tx.execute(sql`UPDATE outbox SET attempts = attempts + 1 WHERE id = ${row.id}`);
        failed += 1;
      }
    }
  });

  return { drained, failed };
}

/**
 * Publishes exactly one outbox row inline (red-team Amendment #3: BEFORE
 * the HTTP response returns, not fire-and-forget after). Used by
 * `PostgresSubmissionService` right after its own transaction commits.
 * Takes its own short `FOR UPDATE` on just that row so it can race
 * safely against a concurrent sweeper pass without double-publishing
 * (the dedup id guards double-publish even if both somehow ran).
 */
export async function publishOutboxRowInline(
  db: Database,
  publisher: Publisher,
  targetUrl: string,
  outboxRowId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const result = (await tx.execute(sql`
      SELECT id, payload FROM outbox WHERE id = ${outboxRowId} AND published_at IS NULL FOR UPDATE
    `)) as unknown as Array<{ id: string; payload: unknown }>;

    const row = result[0];
    if (!row) return false;

    await publisher.publish({ url: targetUrl, body: row.payload, deduplicationId: row.id });
    await tx.execute(sql`UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ${row.id}`);
    return true;
  });
}

/**
 * ADR-0017 §2 TTL cleanup: "24h TTL enforced by a cleanup in the
 * sweeper, not a cron." Called from the same `/internal/outbox/drain`
 * handler as `drainOutbox`, so no separate scheduled worker exists.
 */
export async function cleanupExpiredIdempotencyKeys(db: Database, ttlHours = 24): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM idempotency_keys WHERE created_at < now() - interval '1 hour' * ${ttlHours}
  `);
  // postgres-js's RowList (what drizzle-orm's `.execute()` resolves to)
  // carries the affected-row count as `.count`, NOT `.rowCount` — see
  // `publishOutboxRowInline`'s docblock for how this was verified.
  return (result as unknown as { count: number }).count ?? 0;
}
