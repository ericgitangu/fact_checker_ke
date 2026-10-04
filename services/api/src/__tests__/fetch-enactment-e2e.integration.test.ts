import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { drainOutbox } from "../lib/outbox.js";
import { FakePublisher } from "../lib/publisher.js";
import { enactPublishDecision } from "../lib/publish-enactment.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * END-TO-END PROOF (task brief sub-task 3): a fetched item flows
 * poll -> dedup -> analyze -> verify -> policy -> check.published,
 * through the REAL outbox relay and the REAL enactment function, with a
 * REAL Postgres database — the two seams this codebase actually owns on
 * the TS side.
 *
 * What this test proves, concretely:
 *   1. A `submissions`/`outbox` row shaped EXACTLY like
 *      app/stores/outbox_postgres.py#emit_fetch_submission_received
 *      writes it (ingest_source='fetch') is picked up and relayed by
 *      the REAL `drainOutbox` (the same function the production
 *      `/internal/outbox/drain` sweeper calls) — i.e. the fetch engine's
 *      "poll -> dedup -> emit" output reaches the analyze hop through
 *      the real relay, not an in-process shortcut.
 *   2. The resulting draft `checks` row, once a publish decision
 *      (mirroring app/stages/publish_policy.py's `PublishDecision` for
 *      a Tier-A auto-publish) is handed to `enactPublishDecision`, is
 *      ACTUALLY published: `check.published` is emitted through the
 *      SAME outbox table, carrying `ingest_source: "fetch"` provenance.
 *
 * What this test does NOT prove (explicitly flagged, not hidden): the
 * Python analyze/verify hops are not invoked over real HTTP here — that
 * boundary is separately covered by services/pipeline's own test suite
 * (test_fetch_hop_breaker_and_outbox_wiring.py proves the fetch hop
 * writes the real outbox row via `emit_fetch_submission_received`;
 * test_verify_hop_* proves `finalize_publish`/`decide_publish_policy`
 * produce that `PublishDecision`). There is also no live route in
 * services/api today that calls POST /hops/verify and inserts the
 * resulting draft `checks` row at all (a PRE-EXISTING gap this slice
 * does not close — see the task's final report) — this test seeds that
 * one missing link (a draft `checks` row) directly, which is exactly
 * what such a route would do with a real `/hops/verify` response.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0017/0031/0032 fetch -> outbox -> enactment end-to-end (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
  });

  afterAll(async () => {
    await close();
  });

  it("relays a fetch-sourced outbox row, then enacts its publish decision through to check.published", async () => {
    // --- Step 1: a submission + outbox row, written in the EXACT shape
    // app/stores/outbox_postgres.py#emit_fetch_submission_received
    // writes it (ingest_source='fetch', event_type='submission.received').
    const submissionId = randomUUID();
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const orgId = "00000000-0000-0000-0000-000000000001";
    const payload = {
      event_id: eventId,
      occurred_at: occurredAt,
      submission_id: submissionId,
      org_id: orgId,
      event_type: "submission.received",
      schema_version: "v1",
      payload: {
        url: null,
        text: "Fetched claim: fuel prices will double next month.",
        submitted_by: null,
        quote: null,
        timestamp_sec: null,
        ingest_source: "fetch",
      },
    };

    await db.insert(schema.submissions).values({
      id: submissionId,
      orgId,
      url: null,
      text: payload.payload.text,
      submittedBy: null,
      ingestSource: "fetch",
    });
    const [outboxRow] = await db
      .insert(schema.outbox)
      .values({ aggregateType: "submission", aggregateId: submissionId, eventType: "submission.received", payload })
      .returning();
    await db.insert(schema.submissionEvents).values({
      submissionId,
      eventId,
      eventType: "submission.received",
      payload,
    });

    // --- Step 2: the REAL relay (same function the production sweeper
    // calls) picks the row up and POSTs it to the analyze hop URL.
    const publisher = new FakePublisher();
    const drainResult = await drainOutbox(db, publisher, "https://pipeline.test/hops/analyze");
    expect(drainResult.drained).toBeGreaterThanOrEqual(1);
    expect(publisher.published.some((p) => p.deduplicationId === outboxRow!.id)).toBe(true);
    const relayed = publisher.published.find((p) => p.deduplicationId === outboxRow!.id)!;
    expect((relayed.body as { payload: { ingest_source: string } }).payload.ingest_source).toBe("fetch");

    const [refreshedOutboxRow] = await db.select().from(schema.outbox).where(eq(schema.outbox.id, outboxRow!.id));
    expect(refreshedOutboxRow!.publishedAt).not.toBeNull(); // the relay marked it published

    // --- Step 3: the draft `checks` row a real /hops/verify response
    // would have produced for this submission (see module docblock —
    // this is the one link this test seeds directly rather than over
    // HTTP, since no such route exists in services/api yet).
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId,
        orgId,
        summary: "The claim is contradicted by the official price-cap schedule published this week.",
        rating: null,
        isDraft: true,
        publishedAt: null,
        riskTier: "A",
        calibratedConfidence: "0.96",
      })
      .returning();

    // --- Step 4: the publish decision (mirroring what
    // app/stages/publish_policy.py#decide_publish_policy returns for a
    // Tier-A draft at/above its pre-calibration tau) is ENACTED for
    // real against Postgres.
    const outcome = await enactPublishDecision(db, {
      checkId: check!.id,
      actorId: null,
      ingestSource: "fetch",
      rating: "MostlyTrue",
      summary: check!.summary,
      riskTier: "A",
      decision: {
        autoPublish: true,
        reason: "tier A calibrated_confidence 0.960 >= tau 0.95",
        publishMode: "plain_caveat",
        queuedForAsyncAudit: true,
        requiresHumanTap: false,
      },
      sampleRateAtQueueTime: 1.0,
    });
    expect(outcome.kind).toBe("published");

    const [publishedCheck] = await db.select().from(schema.checks).where(eq(schema.checks.id, check!.id));
    expect(publishedCheck!.isDraft).toBe(false);
    expect(publishedCheck!.publishedAt).not.toBeNull();
    expect(publishedCheck!.ingestSource).toBe("fetch");

    const [publishedEventRow] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.aggregateId, check!.id));
    expect(publishedEventRow!.eventType).toBe("check.published");
    expect((publishedEventRow!.payload as { payload: { ingest_source: string } }).payload.ingest_source).toBe("fetch");
  });

  it("a bare-indictment / no-summary draft never publishes, even via this same real path", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: "fetched claim with a rejected draft", ingestSource: "fetch" })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({ submissionId: submission!.id, summary: "unused", rating: null, isDraft: true, publishedAt: null })
      .returning();

    const outcome = await enactPublishDecision(db, {
      checkId: check!.id,
      actorId: null,
      ingestSource: "fetch",
      rating: "False",
      summary: null, // the rejected-draft case: no rendered summary at all
      riskTier: "A",
      decision: {
        autoPublish: true, // pathological: must still be refused
        reason: "fail-closed",
        publishMode: null,
        queuedForAsyncAudit: false,
        requiresHumanTap: false,
      },
    });
    expect(outcome.kind).toBe("fail_closed_no_summary");

    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, check!.id));
    expect(row!.publishedAt).toBeNull();
  });
});
