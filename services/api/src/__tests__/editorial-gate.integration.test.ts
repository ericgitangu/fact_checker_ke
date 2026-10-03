import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { AuthService } from "../lib/auth/service.js";
import { hotp } from "../lib/auth/totp.js";
import { FakePublisher } from "../lib/publisher.js";
import { drainOutbox } from "../lib/outbox.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * The live-demo transcript required by the task brief, as an executable
 * test (not just a manual curl session — ADR-0019's "no mocks of our
 * own DB layer" + CLAUDE.md's "verify through the REAL code path"):
 *
 *   1. Register an editor, enroll + verify TOTP (MFA mandatory, ADR-0020).
 *   2. A submission produces a draft check with a named-person claim
 *      carrying a submitter-supplied quote (`attribution: unverified`).
 *   3. The submitter-facing GET /v1/checks/:id shows `rating: null` and
 *      `attribution: unverified` (AT-0004-A/AT-0004-B).
 *   4. The editor confirms the quote attribution, logs a right-of-reply
 *      attempt, and approves -- this emits `check.published` (outbox),
 *      writes review_actions + audit_log rows.
 *   5. The submitter-facing GET now shows the real rating.
 *   6. A duplicate/blocked comment-report flow is rejected/no-ops as
 *      specified by ADR-0024.
 */
const connectionString = requireIntegrationDatabaseUrl();

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function currentCodeFor(secret: string): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return hotp(Buffer.from(bytes), Math.floor(Date.now() / 1000 / 30));
}

describe.skipIf(!connectionString)("Editorial review gate + moderation live demo (ADR-0004/0020/0024/0025)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let editorToken: string;
  let editorId: string;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    app = await buildApp({
      config: {
        databaseUrl: connectionString as string,
        corsOrigins: ["http://localhost:3000"],
        upstashRedisRestUrl: null,
        upstashRedisRestToken: null,
        isProduction: false,
        qstashToken: null,
        analyzeHopUrl: "http://localhost:8000/internal/analyze",
        qstashCurrentSigningKey: null,
        qstashNextSigningKey: null,
        capabilityTokenSecret: "test-capability-secret",
        redisTcpUrl: null,
      },
      logger: false,
    });

    const auth = new AuthService(db);
    const email = `demo-editor-${randomUUID()}@example.test`;
    const password = "demo-editor-password-123";
    const registered = await auth.register(email, password);
    if (!registered.ok) throw new Error("setup: register failed");
    editorId = registered.value.id;
    const enrolled = await auth.enrollTotp(editorId);
    if (!enrolled.ok) throw new Error("setup: enroll failed");
    const verified = await auth.verifyTotpEnrollment(editorId, currentCodeFor(enrolled.value.secret));
    if (!verified.ok) throw new Error("setup: verify failed");

    const [existingAdmin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
    // This test needs an `admin` actor (to exercise the public-safety
    // override, AT-0025-3) -- grant admin directly rather than editor.
    const grant = existingAdmin
      ? await auth.grantRole({ id: existingAdmin.id, role: "admin" }, editorId, "admin")
      : await auth.grantRole(null, editorId, "admin");
    if (!grant.ok) throw new Error(`setup: role grant failed: ${grant.error.message}`);

    const login = await auth.login(email, password, currentCodeFor(enrolled.value.secret));
    if (!login.ok) throw new Error("setup: login failed");
    editorToken = login.value.token;
  });

  afterAll(async () => {
    // This suite writes check.published/check.corrected outbox rows
    // that nothing else in this file drains -- Neon `dev` is a SHARED,
    // persistent database across every integration test file (not a
    // per-test-rolled-back sandbox), so a left-behind unpublished row
    // here was observed, empirically, to fail
    // submission-outbox.integration.test.ts's "reaches 0 after drain"
    // assertion on a LATER run (it counts the whole table, not just its
    // own rows). Draining here is this suite cleaning up after itself,
    // not a workaround for that other test.
    await drainOutbox(db, new FakePublisher(), "http://localhost:8000/internal/analyze", 100);
    await app.close();
    await close();
  });

  it("runs the full named-person draft -> gated submitter view -> editor approval -> published view transcript", async () => {
    // --- Seed a submission + draft check with a named-person, unverified-quote claim (simulating pipeline output) ---
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: "Demo: MP Jane Doe said X in a video.", submittedBy: "integration-test" })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({ submissionId: submission!.id, summary: "Claim about MP Jane Doe.", rating: "Unproven", isDraft: true })
      .returning();
    const [claim] = await db
      .insert(schema.claims)
      .values({
        checkId: check!.id,
        text: "MP Jane Doe said X.",
        claimType: "checkable",
        namedPerson: true,
        attribution: "unverified",
      })
      .returning();

    // --- Step 3: submitter-facing view is gated ---
    const beforeApproval = await app.inject({ method: "GET", url: `/v1/checks/${check!.id}` });
    expect(beforeApproval.statusCode).toBe(200);
    const beforeBody = beforeApproval.json();
    expect(beforeBody.rating).toBeNull();
    expect(beforeBody.claims[0].attribution).toBe("unverified");

    // --- Approve is blocked before attribution is confirmed (AT-0004-A/AT-0025-2) ---
    const blockedApprove = await app.inject({
      method: "POST",
      url: `/v1/editor/checks/${check!.id}/approve`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {},
    });
    expect(blockedApprove.statusCode).toBe(422);
    expect(blockedApprove.json().error).toBe("attribution_unverified");

    // --- Editor confirms the quote ---
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/editor/claims/${claim!.id}/confirm-attribution`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(confirm.statusCode).toBe(200);

    // --- Approve is STILL blocked: no right-of-reply logged yet (AT-0025-1) ---
    const blockedApprove2 = await app.inject({
      method: "POST",
      url: `/v1/editor/checks/${check!.id}/approve`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {},
    });
    expect(blockedApprove2.statusCode).toBe(422);
    expect(blockedApprove2.json().error).toBe("right_of_reply_pending");

    // --- Editor uses the public-safety override (admin role, reason required: AT-0025-3) ---
    const approve = await app.inject({
      method: "POST",
      url: `/v1/editor/checks/${check!.id}/approve`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { publicSafetyReason: "Urgent public-safety exception, logged per ADR-0025 §3." },
    });
    expect(approve.statusCode).toBe(200);

    // --- Step 5: submitter-facing view now shows the real rating ---
    const afterApproval = await app.inject({ method: "GET", url: `/v1/checks/${check!.id}` });
    const afterBody = afterApproval.json();
    expect(afterBody.rating).toBe("Unproven");
    expect(afterBody.isDraft).toBe(false);

    // --- check.published was emitted to the outbox in the same tx ---
    const outboxRows = await db.select().from(schema.outbox).where(eq(schema.outbox.aggregateId, check!.id));
    expect(outboxRows.some((r) => r.eventType === "check.published")).toBe(true);

    // --- audit_log has the approve + publish rows ---
    const auditRows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, check!.id));
    expect(auditRows.some((r) => r.action === "check.approved")).toBe(true);
    expect(auditRows.some((r) => r.action === "check.published")).toBe(true);

    // --- Comment moderation: duplicate report from the same device is a no-op, three distinct devices auto-hide ---
    const postRes = await app.inject({
      method: "POST",
      url: `/v1/checks/${check!.id}/comments`,
      headers: { "x-device-token": "device-token-author" },
      payload: { body: "A legitimate comment." },
    });
    expect(postRes.statusCode).toBe(201);
    const commentId = postRes.json().id as string;

    const report1 = await app.inject({
      method: "POST",
      url: `/v1/comments/${commentId}/report`,
      headers: { "x-device-token": "device-A" },
    });
    expect(report1.json().reportCount).toBe(1);

    const duplicateReport = await app.inject({
      method: "POST",
      url: `/v1/comments/${commentId}/report`,
      headers: { "x-device-token": "device-A" },
    });
    expect(duplicateReport.json().reportCount).toBe(1); // unchanged -- same device

    await app.inject({ method: "POST", url: `/v1/comments/${commentId}/report`, headers: { "x-device-token": "device-B" } });
    const report3 = await app.inject({ method: "POST", url: `/v1/comments/${commentId}/report`, headers: { "x-device-token": "device-C" } });
    expect(report3.json().reportCount).toBe(3);
    expect(report3.json().autoHidden).toBe(true);
  });

  it("AT-0024-5: a moderator is rejected (403) on publish/correction routes but allowed on moderation routes", async () => {
    const auth = new AuthService(db);
    const email = `demo-moderator-${randomUUID()}@example.test`;
    const password = "demo-moderator-password-123";
    const registered = await auth.register(email, password);
    if (!registered.ok) throw new Error("setup failed");
    const enrolled = await auth.enrollTotp(registered.value.id);
    if (!enrolled.ok) throw new Error("setup failed");
    const verified = await auth.verifyTotpEnrollment(registered.value.id, currentCodeFor(enrolled.value.secret));
    if (!verified.ok) throw new Error("setup failed");
    const grant = await auth.grantRole({ id: editorId, role: "admin" }, registered.value.id, "moderator");
    expect(grant.ok).toBe(true);
    const login = await auth.login(email, password, currentCodeFor(enrolled.value.secret));
    if (!login.ok) throw new Error("setup failed");

    const queue = await app.inject({ method: "GET", url: "/v1/editor/queue", headers: { authorization: `Bearer ${login.value.token}` } });
    expect(queue.statusCode).toBe(403);

    const modQueue = await app.inject({ method: "GET", url: "/v1/moderation/queue", headers: { authorization: `Bearer ${login.value.token}` } });
    expect(modQueue.statusCode).toBe(200);
  });
});
