import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import type { SubmissionReceivedEvent } from "@fact-checker-ke/core";
import { buildApp } from "../app.js";
import { runSubmissionOrchestration, normalizeClaim } from "../lib/submission-orchestrator.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * Part 1 (avoid duplicate checks in the feed): proves the three root-cause
 * fixes with the REAL orchestrator + REAL DB.
 *  - 1a ingestion dedup: a second submission of the SAME (normalized) claim
 *    never creates a second PUBLISHED check, and is not failed.
 *  - 1b reused-existing-check path: a pipeline dedup short-circuit
 *    (`reused_existing_check: true`, `publish: null`) advances the submission
 *    to `ready`, never `failed`.
 *  - 1c idempotency: a QStash retry (same event_id) of
 *    `/internal/hops/orchestrate` does NOT insert a second check.
 */
const connectionString = requireIntegrationDatabaseUrl();
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const allowAll: SignatureVerifier = { verify: async () => true };

function receivedEvent(submissionId: string, text: string): SubmissionReceivedEvent {
  return {
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    submission_id: submissionId,
    org_id: ORG_ID,
    event_type: "submission.received",
    schema_version: "v1",
    payload: {
      url: null,
      text,
      submitted_by: null,
      quote: null,
      timestamp_sec: null,
      ingest_source: "submission",
      engagement: null,
      virality_score: null,
    },
  };
}

describe.skipIf(!connectionString)("Part 1 — feed de-duplication (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  const toCleanup: string[] = [];

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
  });

  afterAll(async () => {
    // FK-safe cleanup of just this suite's rows (shared tables).
    for (const submissionId of toCleanup) {
      const checkRows = await db.select({ id: schema.checks.id }).from(schema.checks).where(eq(schema.checks.submissionId, submissionId));
      for (const { id } of checkRows) {
        await db.delete(schema.checkEvidence).where(eq(schema.checkEvidence.checkId, id));
      }
      await db.delete(schema.checks).where(eq(schema.checks.submissionId, submissionId));
      await db.delete(schema.submissionEvents).where(eq(schema.submissionEvents.submissionId, submissionId));
      await db.delete(schema.submissions).where(eq(schema.submissions.id, submissionId));
    }
    await close();
  });

  async function seedSubmission(text: string): Promise<string> {
    const id = randomUUID();
    toCleanup.push(id);
    await db.insert(schema.submissions).values({ id, orgId: ORG_ID, url: null, text, submittedBy: null, ingestSource: "submission" });
    return id;
  }

  async function seedPublishedCheck(normalizedClaim: string): Promise<string> {
    const submissionId = await seedSubmission(`seed-${normalizedClaim}`);
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId,
        orgId: ORG_ID,
        summary: "a prior published assessment",
        rating: "MostlyTrue",
        isDraft: false,
        publishedAt: new Date(),
        riskTier: "A",
        normalizedClaim,
      })
      .returning();
    return check!.id;
  }

  it("1a: a second submission of the same (normalized) claim does NOT create a second published check and is not failed", async () => {
    const CLAIM = "The economy grew by 5 percent last year";
    const existingCheckId = await seedPublishedCheck(normalizeClaim(CLAIM));

    const submissionId = await seedSubmission(CLAIM);

    // The analyze hop returns a checkable claim whose NORMALIZED form matches
    // the already-published one (different casing/whitespace on purpose). The
    // verify hop MUST NOT be called — the dedup short-circuits before it.
    const stubFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/hops/analyze")) {
        return Response.json({
          language: "en",
          translation_en: CLAIM,
          claims: [{ text: "  The ECONOMY   grew by 5 Percent last year ", claim_type: "checkable", sampled_for_editor_review: false }],
          attribution: null,
          needs_quote: false,
        });
      }
      throw new Error(`verify must not be called on the dedup path, got: ${u}`);
    }) as unknown as typeof fetch;

    const outcome = await runSubmissionOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      event: receivedEvent(submissionId, CLAIM),
      fetchImpl: stubFetch,
    });

    expect(outcome.kind).toBe("duplicate_published");
    expect(outcome).toMatchObject({ checkId: existingCheckId });

    // No check row was created for the second submission.
    const rows = await db.select().from(schema.checks).where(eq(schema.checks.submissionId, submissionId));
    expect(rows).toHaveLength(0);

    // The submission is a completed, de-duplicated run — `ready`, not `failed`.
    const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId));
    expect(sub!.status).toBe("ready");
  });

  it("1b: a pipeline reused-existing-check short-circuit advances to ready, never failed, and creates no check", async () => {
    const submissionId = await seedSubmission("a claim the pipeline recognises as a duplicate");
    const reusedId = randomUUID();

    const stubFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/hops/analyze")) {
        return Response.json({
          language: "en",
          translation_en: "a claim the pipeline recognises as a duplicate",
          claims: [{ text: "a claim the pipeline recognises as a duplicate", claim_type: "checkable", sampled_for_editor_review: false }],
          attribution: null,
          needs_quote: false,
        });
      }
      if (u.endsWith("/hops/verify")) {
        // The pipeline's embedding dedup short-circuit: a verdict is present,
        // `publish` is null, `reused_existing_check` is true.
        return Response.json({
          verdict: { rating: "True", rationale: "Reused prior check.", confidence: 0.9, what_would_change_this: "New facts.", context: "Matches a prior assessment." },
          rejected: false,
          rejection_reason: null,
          reused_existing_check: true,
          reused_check_id: reusedId,
          evidence: [],
          publish: null,
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const outcome = await runSubmissionOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      event: receivedEvent(submissionId, "a claim the pipeline recognises as a duplicate"),
      fetchImpl: stubFetch,
    });

    expect(outcome.kind).toBe("reused_existing_check");
    expect(outcome).toMatchObject({ checkId: reusedId });

    const rows = await db.select().from(schema.checks).where(eq(schema.checks.submissionId, submissionId));
    expect(rows).toHaveLength(0);

    const [sub] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId));
    expect(sub!.status).toBe("ready"); // NOT "failed" (the pre-fix bug)
  });

  it("1c: a QStash retry (same event_id) of /internal/hops/orchestrate does not insert a second check", async () => {
    const submissionId = await seedSubmission("an idempotency-test claim about public spending");

    // A local stub pipeline (no uvicorn): analyze -> one checkable claim,
    // verify -> an auto-publishable verdict with one cited source.
    const stub: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url?.endsWith("/hops/analyze")) {
          res.end(JSON.stringify({ language: "en", translation_en: "x", claims: [{ text: "public spending rose 12% in 2026", claim_type: "checkable", sampled_for_editor_review: false }], attribution: null, needs_quote: false }));
        } else if (req.url?.endsWith("/hops/verify")) {
          res.end(JSON.stringify({
            verdict: { rating: "MostlyTrue", rationale: "Budget documents corroborate the figure.", confidence: 0.99, what_would_change_this: "A revised budget.", context: "The 12% figure tracks the published estimates." },
            rejected: false, rejection_reason: null, reused_existing_check: false, reused_check_id: null,
            evidence: [{ url: "https://example.com/budget-2026", title: "Budget 2026", publisher: "Treasury", credibility_tier: "tier1_primary", quote: "spending rose 12%", published_at: null }],
            publish: { risk_tier: "A", auto_publish: false, reason: "held", publish_mode: null, queued_for_async_audit: false, requires_human_tap: false },
          }));
        } else {
          res.statusCode = 404;
          res.end("{}");
        }
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const addr = stub.address();
    const pipelineBaseUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

    const app = await buildApp({
      logger: false,
      signatureVerifier: allowAll,
      config: {
        databaseUrl: connectionString as string,
        corsOrigins: ["http://localhost:3000"],
        upstashRedisRestUrl: null,
        upstashRedisRestToken: null,
        isProduction: false,
        qstashToken: null,
        analyzeHopUrl: "unused",
        pipelineBaseUrl,
        qstashCurrentSigningKey: null,
        qstashNextSigningKey: null,
        capabilityTokenSecret: "test-capability-secret",
        redisTcpUrl: null,
      },
    });

    const event = receivedEvent(submissionId, "an idempotency-test claim about public spending");

    try {
      const first = await app.inject({ method: "POST", url: "/internal/hops/orchestrate", payload: event });
      expect(first.statusCode).toBe(200);
      expect((first.json() as { outcome: string }).outcome).toBe("check_created");

      // The retry carries the SAME event_id — it must be acked as a duplicate.
      const second = await app.inject({ method: "POST", url: "/internal/hops/orchestrate", payload: event });
      expect(second.statusCode).toBe(200);
      expect((second.json() as { outcome: string }).outcome).toBe("duplicate_message_acked");

      const rows = await db.select().from(schema.checks).where(eq(schema.checks.submissionId, submissionId));
      expect(rows).toHaveLength(1); // exactly one check despite two deliveries
    } finally {
      await app.close();
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      await db.delete(schema.processedMessages).where(and(eq(schema.processedMessages.messageId, event.event_id), eq(schema.processedMessages.handler, "orchestrate")));
    }
  });
});
