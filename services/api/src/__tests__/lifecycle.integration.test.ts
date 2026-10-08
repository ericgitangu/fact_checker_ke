import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import type { SubmissionReceivedEvent } from "@fact-checker-ke/core";
import { runSubmissionOrchestration } from "../lib/submission-orchestrator.js";
import { approveCheck, getEditorQueue, rejectCheck, sweepExpiredLifecycle } from "../lib/editorial.js";
import { drainOutbox } from "../lib/outbox.js";
import { FakePublisher } from "../lib/publisher.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * ADR-0038 Wave 1 lifecycle, through the REAL code paths against the live
 * `dev` DB (CLAUDE.md "verify through the REAL code path", ADR-0019 "no mocks
 * of our own DB layer"). Covers: contract-A persistence from the verify hop
 * (flag on vs off), the editor queue being bounded to `editor_review` and
 * ordered, the approve→published / reject→dismissed lifecycle transitions, and
 * the auto-expire sweep's two TTLs + terminal-state immunity.
 */
const connectionString = requireIntegrationDatabaseUrl();

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fake pipeline: /hops/analyze → one checkable claim; /hops/verify → the
 * supplied verdict/publish body. No network, no vendor keys. */
function fakePipelineFetch(verifyPublish: Record<string, unknown>, opts?: { context?: string | null }): typeof fetch {
  return (async (url: string) => {
    const json = url.endsWith("/hops/analyze")
      ? {
          language: "en",
          translation_en: "x",
          claims: [{ text: `claim-${randomUUID()}`, claim_type: "checkable", sampled_for_editor_review: false }],
          attribution: null,
          needs_quote: false,
        }
      : {
          verdict: {
            rating: "Unproven",
            rationale: "A held preliminary rationale.",
            confidence: 0.4,
            what_would_change_this: "A tier-1 source.",
            context: opts?.context ?? null,
          },
          rejected: false,
          rejection_reason: null,
          reused_existing_check: false,
          evidence: [],
          publish: verifyPublish,
        };
    return { ok: true, status: 200, json: async () => json, text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
}

function receivedEvent(submissionId: string, orgId: string): SubmissionReceivedEvent {
  return {
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    submission_id: submissionId,
    org_id: orgId,
    event_type: "submission.received",
    schema_version: "v1",
    payload: {
      url: null,
      text: `held item ${randomUUID()}`,
      submitted_by: null,
      quote: null,
      timestamp_sec: null,
      ingest_source: "submission",
      engagement: null,
      virality_score: null,
    },
  };
}

describe.skipIf(!connectionString)("ADR-0038 status-progression lifecycle (real DB)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actorId: string;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `lifecycle-actor-${randomUUID()}@example.test`, passwordHash: "x", role: "editor" })
      .returning();
    actorId = user!.id;
  });

  afterAll(async () => {
    // Drain the check.published outbox rows approveCheck writes, so a later
    // shared-DB test's "outbox reaches 0" assertion isn't tripped (same
    // self-cleanup rationale as editorial-gate.integration.test.ts).
    await drainOutbox(db, new FakePublisher(), "http://localhost:8000/internal/analyze", 100).catch(() => {});
    await close();
  });

  /** Seed a held check directly in a given lifecycle state. */
  async function seedCheck(args: {
    lifecycleState: (typeof schema.checks.$inferSelect)["lifecycleState"];
    viralityScore?: string | null;
    lastActivityAt?: Date | null;
    rating?: (typeof schema.checks.$inferSelect)["rating"];
    isDraft?: boolean;
    publishedAt?: Date | null;
  }): Promise<string> {
    const [sub] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `seed ${randomUUID()}`, submittedBy: "lifecycle-test" })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: sub!.id,
        summary: `seed summary ${randomUUID()}`,
        rating: args.rating ?? "Unproven",
        isDraft: args.isDraft ?? true,
        publishedAt: args.publishedAt ?? null,
        lifecycleState: args.lifecycleState,
        viralityScore: args.viralityScore ?? null,
        lastActivityAt: args.lastActivityAt ?? new Date(),
      })
      .returning();
    return check!.id;
  }

  it("contract A: persists verify-hop lifecycle/source_kind/authoritative when the flag is ON", async () => {
    const [sub] = await db
      .insert(schema.submissions)
      .values({ url: null, text: "contract-a-on", submittedBy: "lifecycle-test" })
      .returning();
    const event = receivedEvent(sub!.id, sub!.orgId);

    const outcome = await runSubmissionOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      event,
      featurePreliminaryThreads: true,
      fetchImpl: fakePipelineFetch({
        risk_tier: "B",
        auto_publish: false,
        reason: "held",
        publish_mode: null,
        queued_for_async_audit: false,
        requires_human_tap: true,
        lifecycle: "preliminary",
        source_kind: "ai_grounded_preliminary",
        authoritative: false,
      }),
    });

    expect(outcome.kind).toBe("check_created");
    const checkId = (outcome as { checkId: string }).checkId;
    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.lifecycleState).toBe("preliminary");
    expect(row!.sourceKind).toBe("ai_grounded_preliminary");
    expect(row!.authoritative).toBe(false);
    expect(row!.lastActivityAt).not.toBeNull();
  });

  it("contract A: IGNORES the hop lifecycle fields when the flag is OFF (ships dark)", async () => {
    const [sub] = await db
      .insert(schema.submissions)
      .values({ url: null, text: "contract-a-off", submittedBy: "lifecycle-test" })
      .returning();
    const event = receivedEvent(sub!.id, sub!.orgId);

    const outcome = await runSubmissionOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      event,
      featurePreliminaryThreads: false,
      fetchImpl: fakePipelineFetch({
        risk_tier: "B",
        auto_publish: false,
        reason: "held",
        publish_mode: null,
        queued_for_async_audit: false,
        requires_human_tap: true,
        lifecycle: "preliminary",
        source_kind: "ai_grounded_preliminary",
        authoritative: false,
      }),
    });

    const checkId = (outcome as { checkId: string }).checkId;
    const [row] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(row!.lifecycleState).toBeNull();
    expect(row!.sourceKind).toBeNull();
    expect(row!.authoritative).toBe(true); // NOT NULL default — never silently non-authoritative
  });

  it("editor queue is bounded to lifecycle_state=editor_review, ordered by virality then recency", async () => {
    // A preliminary + an awaiting_sources must NOT appear; two editor_review
    // items must come back highest-virality-first.
    await seedCheck({ lifecycleState: "preliminary" });
    await seedCheck({ lifecycleState: "awaiting_sources" });
    const lowViral = await seedCheck({ lifecycleState: "editor_review", viralityScore: "1.0" });
    const highViral = await seedCheck({ lifecycleState: "editor_review", viralityScore: "9.0" });

    const queue = await getEditorQueue(db);
    const ids = queue.map((q) => q.checkId);
    expect(ids).toContain(highViral);
    expect(ids).toContain(lowViral);
    // No preliminary/awaiting_sources leaked in.
    const queued = await db
      .select({ id: schema.checks.id, state: schema.checks.lifecycleState })
      .from(schema.checks)
      .where(eq(schema.checks.lifecycleState, "preliminary"));
    for (const p of queued) expect(ids).not.toContain(p.id);
    // Virality ordering: high before low.
    expect(ids.indexOf(highViral)).toBeLessThan(ids.indexOf(lowViral));
  });

  it("approve → published lifecycle; reject → dismissed lifecycle (held drafts, no named person)", async () => {
    const toApprove = await seedCheck({ lifecycleState: "editor_review", rating: "True" });
    const approved = await approveCheck(db, {
      actorId,
      actorRole: "editor",
      checkId: toApprove,
      notes: null,
    });
    expect(approved.ok).toBe(true);
    const [approvedRow] = await db.select().from(schema.checks).where(eq(schema.checks.id, toApprove));
    expect(approvedRow!.lifecycleState).toBe("published");
    expect(approvedRow!.isDraft).toBe(false);
    expect(approvedRow!.publishedAt).not.toBeNull();

    const toReject = await seedCheck({ lifecycleState: "editor_review" });
    const rejected = await rejectCheck(db, actorId, toReject, "not a claim");
    expect(rejected.ok).toBe(true);
    const [rejectedRow] = await db.select().from(schema.checks).where(eq(schema.checks.id, toReject));
    expect(rejectedRow!.lifecycleState).toBe("dismissed");
    // Reject never un-redacts a draft: isDraft/publishedAt untouched.
    expect(rejectedRow!.isDraft).toBe(true);
    expect(rejectedRow!.publishedAt).toBeNull();
  });

  it("sweep archives stale preliminary/awaiting_sources (7d) and editor_review (30d), never terminal or fresh", async () => {
    const stalePrelim = await seedCheck({
      lifecycleState: "preliminary",
      lastActivityAt: new Date(Date.now() - 8 * DAY_MS),
    });
    const freshPrelim = await seedCheck({
      lifecycleState: "preliminary",
      lastActivityAt: new Date(Date.now() - 1 * DAY_MS),
    });
    const staleEditor8d = await seedCheck({
      lifecycleState: "editor_review",
      lastActivityAt: new Date(Date.now() - 8 * DAY_MS),
    });
    const staleEditor31d = await seedCheck({
      lifecycleState: "editor_review",
      lastActivityAt: new Date(Date.now() - 31 * DAY_MS),
    });
    const alreadyPublished = await seedCheck({
      lifecycleState: "published",
      isDraft: false,
      publishedAt: new Date(),
      lastActivityAt: new Date(Date.now() - 99 * DAY_MS),
    });

    const result = await sweepExpiredLifecycle(db, { lifecycleExpiryDays: 7, editorReviewExpiryDays: 30 });
    expect(result.archived).toBeGreaterThanOrEqual(2);

    const stateOf = async (id: string) =>
      (await db.select({ s: schema.checks.lifecycleState }).from(schema.checks).where(eq(schema.checks.id, id)))[0]!.s;

    expect(await stateOf(stalePrelim)).toBe("archived_expired"); // 8d > 7d
    expect(await stateOf(freshPrelim)).toBe("preliminary"); // 1d < 7d, untouched
    expect(await stateOf(staleEditor8d)).toBe("editor_review"); // 8d < 30d, NOT yanked at 7d
    expect(await stateOf(staleEditor31d)).toBe("archived_expired"); // 31d > 30d
    expect(await stateOf(alreadyPublished)).toBe("published"); // terminal, immune
  });
});
