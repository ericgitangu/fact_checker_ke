import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { runReverifyOrchestration } from "../lib/reverify-orchestrator.js";
import { setAutonomousPublishKillSwitch } from "../lib/publish-kill-switch.js";
import type { ReverifyPayload } from "../lib/claim-source.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * ADR-0038 Wave 2 re-verify PERSISTENCE closer, end-to-end against a REAL
 * Postgres (the DATABASE_URL_TEST harness). Drives `runReverifyOrchestration`
 * directly with a STUB pipeline (so no uvicorn process / vendor keys are
 * needed) and asserts the result is actually WRITTEN BACK onto the existing
 * check — the gap the live bug left open (the pipeline re-verified but nothing
 * persisted, so the check stayed preliminary forever).
 *
 * Skips locally when DATABASE_URL_TEST is unset; fails loudly in CI
 * (ADR-0019 via requireIntegrationDatabaseUrl).
 */
const connectionString = requireIntegrationDatabaseUrl();
const ORG_ID = "00000000-0000-0000-0000-000000000001";

function stubVerify(body: {
  rating?: string | null;
  rejected?: boolean;
  evidence?: Array<Record<string, unknown>>;
  context?: string | null;
  autoPublish?: boolean;
  lifecycle?: string | null;
}): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/hops/verify")) {
      return Response.json({
        verdict:
          body.rating === undefined && !body.rejected
            ? { rating: "False", rationale: "Re-verified against the submitted sources.", confidence: 0.98, what_would_change_this: "A credible retraction.", context: body.context ?? "Context leading the re-verified assessment." }
            : body.rating === null
              ? null
              : { rating: body.rating, rationale: "Re-verified against the submitted sources.", confidence: 0.98, what_would_change_this: "A credible retraction.", context: body.context ?? "Context leading the re-verified assessment." },
        rejected: body.rejected ?? false,
        rejection_reason: body.rejected ? "nothing checkable" : null,
        reused_existing_check: false,
        evidence: body.evidence ?? [
          { url: "https://nation.africa/story", title: "Nation", publisher: "nation.africa", credibility_tier: "tier2_established_media", quote: "A supporting quote from the submitted source.", published_at: null },
        ],
        publish: body.rejected
          ? null
          : {
              risk_tier: "B",
              auto_publish: body.autoPublish ?? true,
              reason: "re-verify cleared the band",
              publish_mode: "plain_caveat",
              queued_for_async_audit: false,
              requires_human_tap: false,
              corroboration_state: "agree",
              lifecycle: body.lifecycle === undefined ? "published" : body.lifecycle,
              source_kind: null,
              authoritative: body.lifecycle === "editor_review" ? false : true,
            },
      });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
}

async function seedCheck(
  db: Database,
  args: { lifecycleState: string | null; isDraft: boolean; publishedAt: Date | null },
): Promise<{ submissionId: string; checkId: string }> {
  const submissionId = randomUUID();
  await db.insert(schema.submissions).values({
    id: submissionId,
    orgId: ORG_ID,
    url: null,
    text: "a crowdsourced claim thread",
    submittedBy: null,
    ingestSource: "submission",
  });
  const [check] = await db
    .insert(schema.checks)
    .values({
      submissionId,
      orgId: ORG_ID,
      summary: "Preliminary: awaiting corroborating sources.",
      // A published check must carry a rating (checks_published_requires_rating);
      // a held/preliminary draft has none.
      rating: args.publishedAt ? ("False" as never) : null,
      isDraft: args.isDraft,
      publishedAt: args.publishedAt,
      lifecycleState: args.lifecycleState as never,
      lastActivityAt: new Date(),
    })
    .returning();
  return { submissionId, checkId: check!.id };
}

function payloadFor(submissionId: string): ReverifyPayload {
  return {
    submission_id: submissionId,
    org_id: ORG_ID,
    claim_text: "a crowdsourced claim thread",
    language: "en",
    injected_docs: [{ url: "https://nation.africa/story", title: "nation.africa", text: "reader-submitted corroboration" }],
  };
}

describe.skipIf(!connectionString)("ADR-0038 Wave 2 re-verify persistence (real DB, stubbed pipeline)", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    // Migration 0014 seeds both kill switches frozen; the publish test proves a
    // real auto-publish, so unfreeze the autonomous-publish switch first.
    const [admin] = await db
      .insert(schema.users)
      .values({ email: `reverify-e2e-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    await setAutonomousPublishKillSwitch(db, { actorId: admin!.id, enabled: false });
  }, 30_000);

  afterAll(async () => {
    await close();
  });

  it("no-ops when no check exists for the submission", async () => {
    const outcome = await runReverifyOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      payload: payloadFor(randomUUID()),
      fetchImpl: stubVerify({}),
      featurePreliminaryThreads: true,
    });
    expect(outcome.outcome).toBe("noop");
  });

  it("no-ops on an already-terminal (published) check and never re-verifies it", async () => {
    const { submissionId, checkId } = await seedCheck(db, {
      lifecycleState: "published",
      isDraft: false,
      publishedAt: new Date(),
    });
    // A fetch that throws if called proves the hop is never hit for a terminal check.
    const neverFetch = (async () => {
      throw new Error("pipeline must not be called for a terminal check");
    }) as unknown as typeof fetch;
    const outcome = await runReverifyOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      payload: payloadFor(submissionId),
      fetchImpl: neverFetch,
      featurePreliminaryThreads: true,
    });
    expect(outcome.outcome).toBe("noop");
    const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(check!.lifecycleState).toBe("published");
  });

  it("no-ops on a rejected re-verify and leaves the open thread untouched", async () => {
    const { submissionId, checkId } = await seedCheck(db, {
      lifecycleState: "awaiting_sources",
      isDraft: true,
      publishedAt: null,
    });
    const outcome = await runReverifyOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      payload: payloadFor(submissionId),
      fetchImpl: stubVerify({ rejected: true }),
      featurePreliminaryThreads: true,
    });
    expect(outcome.outcome).toBe("noop");
    const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(check!.isDraft).toBe(true);
    expect(check!.publishedAt).toBeNull();
    expect(check!.lifecycleState).toBe("awaiting_sources");
  });

  it("PUBLISHES an existing non-named thread that clears the band, and persists evidence", async () => {
    const { submissionId, checkId } = await seedCheck(db, {
      lifecycleState: "awaiting_sources",
      isDraft: true,
      publishedAt: null,
    });
    const outcome = await runReverifyOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      payload: payloadFor(submissionId),
      fetchImpl: stubVerify({ autoPublish: true, lifecycle: "published" }),
      featurePreliminaryThreads: true,
    });
    expect(outcome.outcome).toBe("published");
    const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(check!.isDraft).toBe(false);
    expect(check!.publishedAt).not.toBeNull();
    expect(check!.rating).not.toBeNull();
    expect(check!.lifecycleState).toBe("published");
    // Content was written back from the fresh verdict.
    expect(check!.summary).toContain("Re-verified");
    // Evidence rows persisted (sources + check_evidence).
    const evidence = await db.select().from(schema.checkEvidence).where(eq(schema.checkEvidence.checkId, checkId));
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("NEVER auto-publishes a named-person item routed to editor_review, even when auto_publish + publishable", async () => {
    const { submissionId, checkId } = await seedCheck(db, {
      lifecycleState: "editor_review",
      isDraft: true,
      publishedAt: null,
    });
    const outcome = await runReverifyOrchestration({
      db,
      pipelineBaseUrl: "http://pipeline.invalid",
      payload: payloadFor(submissionId),
      fetchImpl: stubVerify({ autoPublish: true, lifecycle: "editor_review" }),
      featurePreliminaryThreads: true,
    });
    expect(outcome.outcome).toBe("updated");
    expect(outcome).toMatchObject({ lifecycle: "editor_review" });
    const [check] = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId));
    expect(check!.isDraft).toBe(true); // HELD, never published
    expect(check!.publishedAt).toBeNull();
    expect(check!.lifecycleState).toBe("editor_review");
    // Content + evidence still persisted on the held thread.
    expect(check!.summary).toContain("Re-verified");
    const evidence = await db.select().from(schema.checkEvidence).where(eq(schema.checkEvidence.checkId, checkId));
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });
});
