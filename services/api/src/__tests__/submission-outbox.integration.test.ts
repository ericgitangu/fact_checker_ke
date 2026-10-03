import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, schema } from "@fact-checker-ke/db";
import { PostgresSubmissionService } from "../lib/submission-service.js";
import { FakePublisher } from "../lib/publisher.js";
import { NoopIdempotencyPreCheck } from "../lib/idempotency.js";
import { advanceWithInbox } from "../lib/advance.js";
import { drainOutbox, cleanupExpiredIdempotencyKeys } from "../lib/outbox.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

const connectionString = requireIntegrationDatabaseUrl();

/**
 * ADR-0017 acceptance tests, against the REAL Postgres (not the
 * in-memory double) — this is the only place the transactional
 * atomicity claims (one tx for submission+idempotency+outbox, the
 * conditional-update state machine, the inbox dedup insert) can
 * actually be proven, per ADR-0019 ("no mocks of our own DB layer").
 */
describe.skipIf(!connectionString)("ADR-0017: transactional outbox + idempotency (Postgres)", () => {
  const { db, close } = createDb(connectionString as string);

  afterAll(async () => {
    await close();
  });

  it("writes the submission, the idempotency row, the outbox row and the submission_events row in ONE commit", async () => {
    const publisher = new FakePublisher();
    const service = new PostgresSubmissionService(
      db,
      new NoopIdempotencyPreCheck(),
      publisher,
      "http://localhost:8000/internal/analyze",
      "test-capability-secret",
    );

    const idempotencyKey = randomUUID();
    const outcome = await service.createWithIdempotency({
      idempotencyKey,
      requestHash: "hash-1",
      submission: { url: null, text: "AT-0017: outbox+idempotency probe " + randomUUID(), submittedBy: null, quote: null, timestampSec: null },
    });

    expect(outcome.kind).toBe("created");
    const submissionId = outcome.kind === "created" ? outcome.body.id : null;
    expect(submissionId).toBeTruthy();

    const [idemRow] = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, idempotencyKey));
    expect(idemRow).toBeDefined();
    expect(idemRow?.responseStatus).toBe(202);

    const outboxRows = await db.select().from(schema.outbox).where(eq(schema.outbox.aggregateId, submissionId as string));
    expect(outboxRows).toHaveLength(1);

    const eventRows = await db
      .select()
      .from(schema.submissionEvents)
      .where(eq(schema.submissionEvents.submissionId, submissionId as string));
    expect(eventRows).toHaveLength(1);

    // AT-0017-B (server-side-testable slice): the relay published to
    // QStash BEFORE this function returned — no sweeper ran.
    expect(publisher.published).toHaveLength(1);
    const publishedRow = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.aggregateId, submissionId as string));
    expect(publishedRow[0]?.publishedAt).not.toBeNull();
  });

  it("replays the stored response (not a new submission) for a repeated idempotency key", async () => {
    const publisher = new FakePublisher();
    const service = new PostgresSubmissionService(db, new NoopIdempotencyPreCheck(), publisher, "http://localhost:8000/internal/analyze", "test-capability-secret");
    const idempotencyKey = randomUUID();
    const submission = { url: null, text: "AT-0017: replay probe " + randomUUID(), submittedBy: null, quote: null, timestampSec: null };

    const first = await service.createWithIdempotency({ idempotencyKey, requestHash: "h", submission });
    const second = await service.createWithIdempotency({ idempotencyKey, requestHash: "h", submission });

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("replay");
    if (first.kind === "created" && second.kind === "replay") {
      expect(second.body).toEqual(first.body);
    }

    const countRow = await db.execute(sql`
      SELECT count(*)::int AS count FROM submissions WHERE text = ${submission.text}
    `);
    expect((countRow[0] as { count: number }).count).toBe(1);
  });

  it("422s a repeated key with a different body, without creating a second submission", async () => {
    const publisher = new FakePublisher();
    const service = new PostgresSubmissionService(db, new NoopIdempotencyPreCheck(), publisher, "http://localhost:8000/internal/analyze", "test-capability-secret");
    const idempotencyKey = randomUUID();
    const marker = randomUUID();

    const first = await service.createWithIdempotency({
      idempotencyKey,
      requestHash: "h1",
      submission: { url: null, text: `AT-0017: conflict probe A ${marker}`, submittedBy: null, quote: null, timestampSec: null },
    });
    const second = await service.createWithIdempotency({
      idempotencyKey,
      requestHash: "h2",
      submission: { url: null, text: `AT-0017: conflict probe B ${marker}`, submittedBy: null, quote: null, timestampSec: null },
    });

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("conflict");

    const rows = await db.execute(sql`SELECT count(*)::int AS count FROM submissions WHERE text LIKE ${"%" + marker}`);
    expect((rows[0] as { count: number }).count).toBe(1);
  });

  it("ADR-0017 §3: a stale/out-of-order conditional update acks with zero rows changed, not an error", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "AT-0017: state machine probe " + randomUUID() })
      .returning();
    const submissionId = submission!.id;

    const result = await advanceWithInbox(db, {
      messageId: randomUUID(),
      handler: "submission-advanced",
      submissionId,
      from: "analyzed", // submission is actually still "received"
      to: "verifying",
      event: null,
    });

    expect(result.outcome).toBe("stale_or_duplicate");
    const [row] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId));
    expect(row?.status).toBe("received");
  });

  it("ADR-0017 §2: a duplicate QStash message id (inbox) is acked without re-running the transition", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "AT-0017: inbox dedup probe " + randomUUID() })
      .returning();
    const submissionId = submission!.id;
    const messageId = randomUUID();

    const first = await advanceWithInbox(db, {
      messageId,
      handler: "submission-advanced",
      submissionId,
      from: "received",
      to: "analyzing",
      event: null,
    });
    const second = await advanceWithInbox(db, {
      messageId, // SAME message id redelivered
      handler: "submission-advanced",
      submissionId,
      from: "received", // if this re-ran, it would be a no-op anyway (already analyzing) —
      to: "analyzing", // the real assertion is that the inbox check short-circuits BEFORE that.
      event: null,
    });

    expect(first.outcome).toBe("advanced");
    expect(second.outcome).toBe("duplicate_message");

    const inboxRows = await db.execute(sql`SELECT count(*)::int AS count FROM processed_messages WHERE message_id = ${messageId}`);
    expect((inboxRows[0] as { count: number }).count).toBe(1);
  });

  it("AT-0017 drain: `select count(*) from outbox where published_at is null` reaches 0 after drain", async () => {
    const publisher = new FakePublisher();
    // Force at least one unpublished row directly (bypassing the inline
    // relay) to prove the SWEEPER path, independent of the inline path
    // already covered above.
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "AT-0017: drain probe " + randomUUID() })
      .returning();
    await db.insert(schema.outbox).values({
      aggregateType: "submission",
      aggregateId: submission!.id,
      eventType: "submission.received",
      payload: { marker: "drain-probe" },
    });

    const before = await db.execute(sql`SELECT count(*)::int AS count FROM outbox WHERE published_at IS NULL`);
    expect((before[0] as { count: number }).count).toBeGreaterThan(0);

    await drainOutbox(db, publisher, "http://localhost:8000/internal/analyze", 1000);

    const after = await db.execute(sql`SELECT count(*)::int AS count FROM outbox WHERE published_at IS NULL`);
    expect((after[0] as { count: number }).count).toBe(0);
  });

  it("the idempotency-key TTL cleanup removes rows older than 24h and keeps fresh ones", async () => {
    const freshKey = randomUUID();
    const staleKey = randomUUID();
    await db.insert(schema.idempotencyKeys).values([
      { key: freshKey, requestHash: "h", responseStatus: 202, responseBody: {} },
      { key: staleKey, requestHash: "h", responseStatus: 202, responseBody: {} },
    ]);
    await db.execute(sql`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = ${staleKey}`);

    await cleanupExpiredIdempotencyKeys(db, 24);

    const [freshRow] = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, freshKey));
    const [staleRow] = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, staleKey));
    expect(freshRow).toBeDefined();
    expect(staleRow).toBeUndefined();
  });
});
