import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0024-1: a comment containing a flagged pattern never becomes
 * publicly visible without editor release (held `pending`, invisible
 * to GET /v1/checks/:id/comments for anyone but its own author -- this
 * wave's reader-list endpoint only returns `visible` rows at all).
 * AT-0024-3: a check tagged to an ONGOING protest event rejects new
 * comments, and (re-)allows them once concluded.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("Comment moderation (ADR-0024, integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let app: FastifyInstance;

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
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  async function createPublishedCheck(demonstrationId: string | null) {
    const [submission] = await db.insert(schema.submissions).values({ url: null, text: `comment-test-${randomUUID()}` }).returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "Moderation test check.",
        rating: "Unproven",
        isDraft: false,
        publishedAt: new Date(),
        demonstrationId,
      })
      .returning();
    return check!.id;
  }

  it("AT-0024-1: a flagged comment is held pending, not publicly visible", async () => {
    const checkId = await createPublishedCheck(null);
    const post = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/comments`,
      headers: { "x-device-token": "flagged-commenter" },
      payload: { body: "call me on 0712345678" },
    });
    expect(post.statusCode).toBe(201);
    expect(post.json().status).toBe("pending");

    const list = await app.inject({ method: "GET", url: `/v1/checks/${checkId}/comments` });
    expect(list.json().items).toHaveLength(0);
  });

  it("AT-0024-3: an ongoing protest event rejects new comments; a concluded one allows them", async () => {
    const [demo] = await db
      .insert(schema.demonstrations)
      .values({ title: "Test maandamano", area: "CBD", county: "Nairobi", status: "ongoing", summary: "test" })
      .returning();
    const checkId = await createPublishedCheck(demo!.id);

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/comments`,
      headers: { "x-device-token": "device-x" },
      payload: { body: "a perfectly civil comment" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error).toBe("comments_disabled_ongoing_event");

    await db.update(schema.demonstrations).set({ status: "ended" }).where(eq(schema.demonstrations.id, demo!.id));

    const allowed = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/comments`,
      headers: { "x-device-token": "device-x" },
      payload: { body: "now that it has concluded" },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it("AT-0024-4: an abuse-contact path is reachable and distinct from a general feedback form", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/abuse-contact" });
    expect(res.statusCode).toBe(200);
    expect(res.json().contact).toMatch(/@/);
    expect(res.json().distinctFrom).toBeTruthy();
  });
});
