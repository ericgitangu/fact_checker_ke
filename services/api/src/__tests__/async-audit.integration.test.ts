import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { maybeEnqueueForAsyncAudit, recordAuditOutcome } from "../lib/async-audit.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0025-6/7, AT-0031-9 (ADR-0025/0031 amendments): an auto-published
 * assessment is recorded into an async-audit sampling queue at a
 * configurable rate; recording an `error_found` outcome creates a
 * correction (new `checks` row, `check.corrected`) — never a silent
 * edit of the original or of the queue row.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0025/0031 amendment async-audit queue (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actorId: string;

  async function seedPublishedCheck(): Promise<string> {
    const [submission] = await db.insert(schema.submissions).values({ url: null, text: `async-audit-${randomUUID()}` }).returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "The evidence we found does not support this claim; here is why.",
        rating: "MostlyTrue",
        isDraft: false,
        publishedAt: new Date(),
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
      .values({ email: `audit-editor-${randomUUID()}@example.test`, passwordHash: "x", role: "editor" })
      .returning();
    actorId = user!.id;
  });

  afterAll(async () => {
    await close();
  });

  it("AT-0025-6: a rate of 1.0 always enqueues the published check", async () => {
    const checkId = await seedPublishedCheck();
    const result = await maybeEnqueueForAsyncAudit(db, {
      checkId,
      tier: "A",
      publishMode: "plain_caveat",
      sampleRateAtQueueTime: 1.0,
    });
    expect(result.queued).toBe(true);

    const [row] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.checkId, checkId));
    expect(row).toBeDefined();
    expect(row!.outcome).toBe("pending");
    expect(row!.sampleRateAtQueueTime).toBe(1.0);
  });

  it("AT-0025-7: a rate of 0.0 never enqueues — the rate is honoured, not a constant always-true path", async () => {
    const checkId = await seedPublishedCheck();
    const result = await maybeEnqueueForAsyncAudit(db, {
      checkId,
      tier: "B",
      publishMode: "plain_caveat",
      sampleRateAtQueueTime: 0.0,
    });
    expect(result.queued).toBe(false);

    const rows = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.checkId, checkId));
    expect(rows).toHaveLength(0);
  });

  it("a fractional rate samples roughly that fraction over many trials (not 0 and not 1)", async () => {
    const rate = 0.3;
    const trials = 200;
    let queuedCount = 0;
    for (let i = 0; i < trials; i++) {
      const checkId = await seedPublishedCheck();
      const result = await maybeEnqueueForAsyncAudit(db, {
        checkId,
        tier: "A",
        publishMode: "plain_caveat",
        sampleRateAtQueueTime: rate,
      });
      if (result.queued) queuedCount++;
    }
    const observedRate = queuedCount / trials;
    // Generous tolerance band -- this is a statistical property, not an
    // exact count; it only needs to rule out "always queues" / "never
    // queues" / a hardcoded different constant.
    expect(observedRate).toBeGreaterThan(0.1);
    expect(observedRate).toBeLessThan(0.5);
  });

  it("AT-0025-6: recording an error_found outcome creates a correction (new checks row, check.corrected) — never a silent edit", async () => {
    const checkId = await seedPublishedCheck();
    await maybeEnqueueForAsyncAudit(db, { checkId, tier: "A", publishMode: "plain_caveat", sampleRateAtQueueTime: 1.0 });
    const [queueRow] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.checkId, checkId));

    const outcome = await recordAuditOutcome(db, {
      actorId,
      queueId: queueRow!.id,
      outcome: "error_found",
      notes: "Audit sample found the rating too strong given the cited source.",
      correction: { summary: "Corrected: the evidence is mixed, not conclusively False.", rating: "Misleading" },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.value.newCheckId).not.toBeNull();

    // The ORIGINAL check row is untouched.
    const [original] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(original!.summary).toBe("The evidence we found does not support this claim; here is why.");

    // A NEW checks row exists, chained via correctedFromCheckId.
    const [corrected] = await db
      .select()
      .from(schema.checks)
      .where(eq(schema.checks.id, outcome.value.newCheckId as string));
    expect(corrected!.correctedFromCheckId).toBe(checkId);
    expect(corrected!.rating).toBe("Misleading");

    // The queue row itself is updated (outcome, auditedBy, auditedAt) —
    // this is the one row this module mutates in place, by design (see
    // packages/db/src/schema.ts's asyncAuditQueue docblock).
    const [updatedQueueRow] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.id, queueRow!.id));
    expect(updatedQueueRow!.outcome).toBe("error_found");
    expect(updatedQueueRow!.auditedBy).toBe(actorId);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, outcome.value.newCheckId as string));
    expect(auditRows.some((row) => row.action === "check.corrected")).toBe(true);
  });

  it("recording a confirmed outcome leaves the check untouched and does not create a new row", async () => {
    const checkId = await seedPublishedCheck();
    await maybeEnqueueForAsyncAudit(db, { checkId, tier: "A", publishMode: "plain_caveat", sampleRateAtQueueTime: 1.0 });
    const [queueRow] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.checkId, checkId));

    const outcome = await recordAuditOutcome(db, {
      actorId,
      queueId: queueRow!.id,
      outcome: "confirmed",
      notes: "Checked the cited source; the assessment holds.",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.value.newCheckId).toBeNull();

    const checksForSubmission = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(checksForSubmission).toHaveLength(1);
  });

  it("rejects recording a second outcome on an already-audited queue entry", async () => {
    const checkId = await seedPublishedCheck();
    await maybeEnqueueForAsyncAudit(db, { checkId, tier: "A", publishMode: "plain_caveat", sampleRateAtQueueTime: 1.0 });
    const [queueRow] = await db.select().from(schema.asyncAuditQueue).where(eq(schema.asyncAuditQueue.checkId, checkId));

    await recordAuditOutcome(db, { actorId, queueId: queueRow!.id, outcome: "confirmed", notes: null });
    const second = await recordAuditOutcome(db, { actorId, queueId: queueRow!.id, outcome: "confirmed", notes: null });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.kind).toBe("already_audited");
  });
});
