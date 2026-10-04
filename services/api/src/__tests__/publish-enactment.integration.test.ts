import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { enactPublishDecision } from "../lib/publish-enactment.js";
import { setAutonomousPublishKillSwitch } from "../lib/publish-kill-switch.js";
import { setFetchEngineKillSwitch } from "../lib/fetch-kill-switch.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * ADR-0031 amendment / ADR-0032 (two-engine pivot) — the API-side
 * enactment of a pipeline publish decision (task brief sub-task 3):
 * auto_publish -> check.published; requires_human_tap / plain human-gate
 * -> left pending; fail-closed on a missing summary; the fetch
 * kill-switch additionally blocks ONLY fetch-sourced auto-publish.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0031/0032 publish-decision enactment (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actorId: string;

  async function seedDraftCheck(ingestSource: "submission" | "fetch" = "submission"): Promise<string> {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `enactment-${randomUUID()}`, ingestSource })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "draft, not yet published",
        rating: null,
        isDraft: true,
        publishedAt: null,
      })
      .returning();
    return check!.id;
  }

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `enactment-admin-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    actorId = user!.id;
  });

  afterEach(async () => {
    // Reset both kill switches to "live" between tests — same audited
    // write path a real operator would use, not a raw DELETE.
    await setAutonomousPublishKillSwitch(db, { actorId, enabled: false });
    await setFetchEngineKillSwitch(db, { actorId, enabled: false });
  });

  afterAll(async () => {
    await close();
  });

  it("auto_publish=true publishes: isDraft=false, publishedAt set, check.published emitted with ingest_source carried", async () => {
    const checkId = await seedDraftCheck("submission");
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "submission",
      rating: "MostlyTrue",
      summary: "The evidence supports this rating.",
      riskTier: "A",
      decision: { autoPublish: true, reason: "tau met", publishMode: "plain_caveat", queuedForAsyncAudit: true, requiresHumanTap: false },
      sampleRateAtQueueTime: 1.0,
    });
    expect(outcome.kind).toBe("published");

    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.isDraft).toBe(false);
    expect(row!.publishedAt).not.toBeNull();
    expect(row!.rating).toBe("MostlyTrue");
    expect(row!.ingestSource).toBe("submission");

    const [outboxRow] = await db.select().from(schema.outbox).where(eq(schema.outbox.aggregateId, checkId));
    expect(outboxRow).toBeDefined();
    expect(outboxRow!.eventType).toBe("check.published");
    expect((outboxRow!.payload as { payload: { ingest_source: string } }).payload.ingest_source).toBe("submission");

    const [auditQueueRow] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.checkId, checkId));
    expect(auditQueueRow).toBeDefined();
  });

  it("a fetch-sourced auto_publish=true carries ingest_source='fetch' onto the published check and its event", async () => {
    const checkId = await seedDraftCheck("fetch");
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "fetch",
      rating: "Unproven",
      summary: "A claim-attributed open question, caveated.",
      riskTier: "C",
      decision: { autoPublish: true, reason: "tau met (mode a)", publishMode: "open_question", queuedForAsyncAudit: true, requiresHumanTap: false },
      sampleRateAtQueueTime: 1.0,
    });
    expect(outcome.kind).toBe("published");

    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.ingestSource).toBe("fetch");

    const [outboxRow] = await db.select().from(schema.outbox).where(eq(schema.outbox.aggregateId, checkId));
    expect((outboxRow!.payload as { payload: { ingest_source: string } }).payload.ingest_source).toBe("fetch");
  });

  it("requires_human_tap=true leaves the check as an unpublished draft", async () => {
    const checkId = await seedDraftCheck();
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "submission",
      rating: "Unproven",
      summary: "something",
      riskTier: "C",
      decision: { autoPublish: false, reason: "Tier C mode (b): human tap required", publishMode: null, queuedForAsyncAudit: false, requiresHumanTap: true },
    });
    expect(outcome.kind).toBe("left_pending");

    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.isDraft).toBe(true);
    expect(row!.publishedAt).toBeNull();
  });

  it("the plain below-threshold human-gate outcome (auto_publish=false, requires_human_tap=false) also leaves the check pending", async () => {
    const checkId = await seedDraftCheck();
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "submission",
      rating: "Unproven",
      summary: "something",
      riskTier: "B",
      decision: { autoPublish: false, reason: "below tau; human gate", publishMode: null, queuedForAsyncAudit: false, requiresHumanTap: false },
    });
    expect(outcome.kind).toBe("left_pending");
    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.publishedAt).toBeNull();
  });

  it("FAIL-CLOSED: auto_publish=true with a missing summary never publishes, even though the decision says so", async () => {
    const checkId = await seedDraftCheck();
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "submission",
      rating: "MostlyTrue",
      summary: null, // pathological: a decision that lies about auto_publish with no summary
      riskTier: "A",
      decision: { autoPublish: true, reason: "tau met", publishMode: "plain_caveat", queuedForAsyncAudit: true, requiresHumanTap: false },
    });
    expect(outcome.kind).toBe("fail_closed_no_summary");

    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.isDraft).toBe(true);
    expect(row!.publishedAt).toBeNull();

    const auditRows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, checkId));
    expect(auditRows.some((r) => r.action === "check.auto_publish_blocked")).toBe(true);
  });

  it("FAIL-CLOSED: a bare whitespace-only summary is also treated as missing", async () => {
    const checkId = await seedDraftCheck();
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "submission",
      rating: "MostlyTrue",
      summary: "   ",
      riskTier: "A",
      decision: { autoPublish: true, reason: "tau met", publishMode: "plain_caveat", queuedForAsyncAudit: true, requiresHumanTap: false },
    });
    expect(outcome.kind).toBe("fail_closed_no_summary");
  });

  it("the fetch kill switch blocks a fetch-sourced auto-publish but does NOT touch a submission-sourced one", async () => {
    await setFetchEngineKillSwitch(db, { actorId, enabled: true });

    const fetchCheckId = await seedDraftCheck("fetch");
    const fetchOutcome = await enactPublishDecision(db, {
      checkId: fetchCheckId,
      actorId: null,
      ingestSource: "fetch",
      rating: "Unproven",
      summary: "caveated open question",
      riskTier: "C",
      decision: { autoPublish: true, reason: "tau met", publishMode: "open_question", queuedForAsyncAudit: true, requiresHumanTap: false },
    });
    expect(fetchOutcome.kind).toBe("blocked_by_fetch_kill_switch");
    const [fetchRow] = await db.select().from(schema.checks).where(eq(schema.checks.id, fetchCheckId));
    expect(fetchRow!.publishedAt).toBeNull();

    const submissionCheckId = await seedDraftCheck("submission");
    const submissionOutcome = await enactPublishDecision(db, {
      checkId: submissionCheckId,
      actorId: null,
      ingestSource: "submission",
      rating: "MostlyTrue",
      summary: "the evidence supports this",
      riskTier: "A",
      decision: { autoPublish: true, reason: "tau met", publishMode: "plain_caveat", queuedForAsyncAudit: true, requiresHumanTap: false },
    });
    expect(submissionOutcome.kind).toBe("published");
    const [submissionRow] = await db.select().from(schema.checks).where(eq(schema.checks.id, submissionCheckId));
    expect(submissionRow!.publishedAt).not.toBeNull();
  });

  it("the global autonomous-publish kill switch blocks publishing regardless of ingest source", async () => {
    await setAutonomousPublishKillSwitch(db, { actorId, enabled: true });
    const checkId = await seedDraftCheck("submission");
    const outcome = await enactPublishDecision(db, {
      checkId,
      actorId: null,
      ingestSource: "submission",
      rating: "MostlyTrue",
      summary: "the evidence supports this",
      riskTier: "A",
      decision: { autoPublish: true, reason: "tau met", publishMode: "plain_caveat", queuedForAsyncAudit: true, requiresHumanTap: false },
    });
    expect(outcome.kind).toBe("blocked_by_fetch_kill_switch");
  });

  it("re-enacting an already-published check is an idempotent no-op (does not re-publish or duplicate the outbox row)", async () => {
    const checkId = await seedDraftCheck();
    const decision = { autoPublish: true, reason: "tau met", publishMode: "plain_caveat", queuedForAsyncAudit: true, requiresHumanTap: false } as const;
    await enactPublishDecision(db, { checkId, actorId: null, ingestSource: "submission", rating: "MostlyTrue", summary: "x", riskTier: "A", decision });
    const second = await enactPublishDecision(db, { checkId, actorId: null, ingestSource: "submission", rating: "MostlyTrue", summary: "x", riskTier: "A", decision });
    expect(second.kind).toBe("published");

    const outboxRows = await db.select().from(schema.outbox).where(eq(schema.outbox.aggregateId, checkId));
    expect(outboxRows).toHaveLength(1);
  });
});
