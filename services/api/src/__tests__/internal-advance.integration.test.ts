import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@fact-checker-ke/db";
import { buildApp } from "../app.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";
import { InMemoryPubSub } from "../lib/pubsub.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";

const connectionString = requireIntegrationDatabaseUrl();
const allow: SignatureVerifier = { verify: async () => true };

describe.skipIf(!connectionString)("POST /internal/events/submission-advanced (ADR-0017 §3/§5, Postgres)", () => {
  const { db, close } = createDb(connectionString as string);

  afterAll(async () => {
    await close();
  });

  it("advances state, writes submission_events, and publishes to the sub:{id} channel AFTER commit", async () => {
    const pubsub = new InMemoryPubSub();
    const received: string[] = [];
    await pubsub.subscribe(`sub:placeholder`, () => {}); // warms listener machinery, replaced below

    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "internal-advance probe " + randomUUID() })
      .returning();
    const submissionId = submission!.id;

    const unsubscribe = await pubsub.subscribe(`sub:${submissionId}`, (msg) => {
      received.push(msg);
    });

    const app = await buildApp({
      logger: false,
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
        capabilityTokenSecret: "test-secret",
        redisTcpUrl: null,
      },
      signatureVerifier: allow,
      pubsub,
    });

    const res = await app.inject({
      method: "POST",
      url: "/internal/events/submission-advanced",
      payload: {
        messageId: randomUUID(),
        submissionId,
        from: "received",
        to: "analyzing",
        event: null,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: "advanced" });

    const [row] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId));
    expect(row?.status).toBe("analyzing");

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]!) as { status: string };
    expect(parsed.status).toBe("analyzing");

    await unsubscribe();
    await app.close();
  });

  it("acks a stale/out-of-order transition with 200, not an error", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "internal-advance stale probe " + randomUUID() })
      .returning();

    const app = await buildApp({
      logger: false,
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
        capabilityTokenSecret: "test-secret",
        redisTcpUrl: null,
      },
      signatureVerifier: allow,
      pubsub: new InMemoryPubSub(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/internal/events/submission-advanced",
      payload: { messageId: randomUUID(), submissionId: submission!.id, from: "analyzed", to: "verifying", event: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: "stale_or_duplicate_acked" });
    await app.close();
  });

  it("the dev simulator drives a submission through every hop via the real handler path", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "dev-simulate probe " + randomUUID() })
      .returning();

    const app = await buildApp({
      logger: false,
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
        capabilityTokenSecret: "test-secret",
        redisTcpUrl: null,
      },
      pubsub: new InMemoryPubSub(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/internal/dev/simulate",
      payload: { submissionId: submission!.id },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { outcomes: Array<{ to: string; outcome: string }> };
    expect(body.outcomes.map((o) => o.outcome)).toEqual(["advanced", "advanced", "advanced", "advanced"]);

    const [row] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, submission!.id));
    expect(row?.status).toBe("ready");
    await app.close();
  });
});
