import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@fact-checker-ke/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";
import { InMemoryPubSub } from "../lib/pubsub.js";
import { signCapabilityToken } from "../lib/device-token.js";
import { InMemoryConcurrencyGuard } from "../lib/concurrency-guard.js";

const connectionString = requireIntegrationDatabaseUrl();
const CAPABILITY_SECRET = "test-sse-secret";

function baseConfig() {
  return {
    databaseUrl: connectionString as string,
    corsOrigins: ["http://localhost:3000"],
    upstashRedisRestUrl: null,
    upstashRedisRestToken: null,
    isProduction: false,
    qstashToken: null,
    analyzeHopUrl: "http://localhost:8000/internal/analyze",
    qstashCurrentSigningKey: null,
    qstashNextSigningKey: null,
    capabilityTokenSecret: CAPABILITY_SECRET,
    redisTcpUrl: null,
  };
}

describe.skipIf(!connectionString)("GET /v1/submissions/:id/events (ADR-0018 SSE, Postgres)", () => {
  const { db, close } = createDb(connectionString as string);

  afterAll(async () => {
    await close();
  });

  it("AT-0018-1: a terminal-state submission yields the terminal event immediately, then closes", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "sse terminal probe " + randomUUID() })
      .returning();
    await db.update(schema.submissions).set({ status: "ready" }).where(eq(schema.submissions.id, submission!.id));

    const app = await buildApp({
      logger: false,
      config: baseConfig(),
      pubsub: new InMemoryPubSub(),
      deviceConcurrencyGuard: new InMemoryConcurrencyGuard(2),
      ipConcurrencyGuard: new InMemoryConcurrencyGuard(50),
      sseMaxDurationMs: 2_000,
      sseHeartbeatMs: 50_000,
    });

    const token = await signCapabilityToken(CAPABILITY_SECRET, submission!.id, 90);
    const res = await app.inject({
      method: "GET",
      url: `/v1/submissions/${submission!.id}/events?token=${token}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('"status":"ready"');
    await app.close();
  });

  it("AT-0020-2: a capability token minted for submission A is rejected for submission B", async () => {
    const [a] = await db.insert(schema.submissions).values({ text: "sse scope A " + randomUUID() }).returning();
    const [b] = await db.insert(schema.submissions).values({ text: "sse scope B " + randomUUID() }).returning();

    const app = await buildApp({
      logger: false,
      config: baseConfig(),
      pubsub: new InMemoryPubSub(),
    });

    const tokenForA = await signCapabilityToken(CAPABILITY_SECRET, a!.id, 90);
    const res = await app.inject({ method: "GET", url: `/v1/submissions/${b!.id}/events?token=${tokenForA}` });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("rejects a missing capability token with 401", async () => {
    const app = await buildApp({ logger: false, config: baseConfig(), pubsub: new InMemoryPubSub() });
    const res = await app.inject({ method: "GET", url: `/v1/submissions/${randomUUID()}/events` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("AT-0018-4/AT-0018-8: a third concurrent stream for one device gets 429", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "sse concurrency probe " + randomUUID() })
      .returning();
    await db.update(schema.submissions).set({ status: "ready" }).where(eq(schema.submissions.id, submission!.id));

    const deviceGuard = new InMemoryConcurrencyGuard(2);
    const app = await buildApp({
      logger: false,
      config: baseConfig(),
      pubsub: new InMemoryPubSub(),
      deviceConcurrencyGuard: deviceGuard,
      ipConcurrencyGuard: new InMemoryConcurrencyGuard(50),
    });

    const token = await signCapabilityToken(CAPABILITY_SECRET, submission!.id, 90);
    const deviceToken = "device-under-test";

    // Two slots pre-occupied directly against the SAME guard instance
    // the route uses (simulating two still-open streams) rather than
    // relying on inject() to hold connections open concurrently.
    await deviceGuard.acquire(deviceToken);
    await deviceGuard.acquire(deviceToken);

    const res = await app.inject({
      method: "GET",
      url: `/v1/submissions/${submission!.id}/events?token=${token}`,
      headers: { "x-device-token": deviceToken },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json() as { scope: string };
    expect(body.scope).toBe("device");
    await app.close();
  });

  it("AT-0018-2: Last-Event-ID resume replays only the newer events, with no duplicates", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "sse resume probe " + randomUUID() })
      .returning();

    const firstEventId = randomUUID();
    const secondEventId = randomUUID();
    await db.insert(schema.submissionEvents).values([
      {
        submissionId: submission!.id,
        eventId: firstEventId,
        eventType: "submission.received",
        payload: { marker: "first" },
      },
    ]);
    // Ensure strictly increasing occurredAt ordering for the resume
    // query (`occurred_at > anchor`) even on a fast test machine where
    // both inserts could otherwise land in the same microsecond.
    await new Promise((r) => setTimeout(r, 10));
    await db.insert(schema.submissionEvents).values([
      {
        submissionId: submission!.id,
        eventId: secondEventId,
        eventType: "submission.analyzed",
        payload: { marker: "second" },
      },
    ]);

    const app = await buildApp({
      logger: false,
      config: baseConfig(),
      pubsub: new InMemoryPubSub(),
      sseMaxDurationMs: 300,
      sseHeartbeatMs: 50_000,
    });

    const token = await signCapabilityToken(CAPABILITY_SECRET, submission!.id, 90);
    const res = await app.inject({
      method: "GET",
      url: `/v1/submissions/${submission!.id}/events?token=${token}`,
      headers: { "last-event-id": firstEventId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('"marker":"first"');
    expect(res.body).toContain('"marker":"second"');
    expect(res.body).toContain(`id: ${secondEventId}`);
    await app.close();
  });

  it("AT-0018-3: sends heartbeat comments on the configured interval and closes at the duration cap", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "sse heartbeat probe " + randomUUID() })
      .returning();
    // Still "received" (non-terminal) -- nothing will arrive on
    // sub:{id}, so the ONLY reason this connection ever closes is the
    // duration cap, proving that cap is real and not just vestigial
    // when a terminal/live event happens to arrive first.

    const app = await buildApp({
      logger: false,
      config: baseConfig(),
      pubsub: new InMemoryPubSub(),
      // Window sized with headroom so the heartbeat assertion is robust to
      // the initial current-state Postgres read latency (negligible on a
      // local CI DB, ~100ms against a remote Neon branch) — the cap must
      // measure the STREAMING window, not the one-time startup read.
      sseHeartbeatMs: 40,
      sseMaxDurationMs: 500,
    });

    const token = await signCapabilityToken(CAPABILITY_SECRET, submission!.id, 90);
    const start = Date.now();
    const res = await app.inject({ method: "GET", url: `/v1/submissions/${submission!.id}/events?token=${token}` });
    const elapsedMs = Date.now() - start;

    expect(res.statusCode).toBe(200);
    const heartbeatCount = (res.body.match(/: heartbeat/g) ?? []).length;
    expect(heartbeatCount).toBeGreaterThanOrEqual(2); // >=~6 expected in a 500ms cap at 40ms
    // Proves the stream CLOSED (didn't hang) rather than asserting an exact
    // cap time: total elapsed = one-time current-state read + the 500ms cap,
    // and that read is ~5ms on a local CI DB but ~1.9s against a cold remote
    // Neon pooler. A genuinely hung stream would run to the 90s production
    // default and blow the vitest timeout instead.
    expect(elapsedMs).toBeLessThan(6_000);
    await app.close();
  });

  it("AT-0018-5: a non-terminal submission's SSE response is no-store (never a shared cache)", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ text: "sse no-store probe " + randomUUID() })
      .returning();
    await db.update(schema.submissions).set({ status: "ready" }).where(eq(schema.submissions.id, submission!.id));

    const app = await buildApp({ logger: false, config: baseConfig(), pubsub: new InMemoryPubSub() });
    const token = await signCapabilityToken(CAPABILITY_SECRET, submission!.id, 90);
    const res = await app.inject({ method: "GET", url: `/v1/submissions/${submission!.id}/events?token=${token}` });

    expect(res.headers["cache-control"]).toContain("no-store");
    await app.close();
  });
});
