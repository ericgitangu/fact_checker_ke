import type { FastifyInstance } from "fastify";
import { eq, and, gt, ne, sql } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { SubmissionStatus } from "@fact-checker-ke/core";
import { verifyCapabilityToken } from "../lib/device-token.js";
import type { PubSub } from "../lib/pubsub.js";
import type { ConcurrencyGuard } from "../lib/concurrency-guard.js";
import { NO_STORE_CACHE_CONTROL } from "../lib/cache-headers.js";

const TERMINAL_STATUSES: readonly SubmissionStatus[] = ["ready", "failed"];

export interface SseRouteDeps {
  db: Database | null;
  pubsub: PubSub;
  capabilityTokenSecret: string;
  /** ADR-0018 §5 / red-team C-9: keyed on device token, limit 2. */
  deviceGuard: ConcurrencyGuard;
  /** Coarse IP ceiling (>=50), never the primary guard. */
  ipGuard: ConcurrencyGuard;
  heartbeatMs?: number;
  maxDurationMs?: number;
}

function sseEvent(data: unknown, id?: string): string {
  const lines = [`data: ${JSON.stringify(data)}`];
  if (id) lines.unshift(`id: ${id}`);
  return `${lines.join("\n")}\n\n`;
}

export async function sseRoutes(app: FastifyInstance, deps: SseRouteDeps): Promise<void> {
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const maxDurationMs = deps.maxDurationMs ?? 90_000;

  app.get<{ Params: { id: string } }>("/v1/submissions/:id/events", async (request, reply) => {
    const submissionId = request.params.id;

    const tokenFromQuery = (request.query as Record<string, unknown> | undefined)?.token;
    const authHeader = request.headers.authorization;
    const token =
      (typeof tokenFromQuery === "string" ? tokenFromQuery : undefined) ??
      (authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined);

    if (!token) {
      return reply.status(401).send({ error: "capability_token_required" });
    }

    const verified = await verifyCapabilityToken(deps.capabilityTokenSecret, token, submissionId);
    if (!verified.ok) {
      const status = verified.reason === "wrong_submission" ? 403 : 401;
      return reply.status(status).send({ error: "invalid_capability_token", reason: verified.reason });
    }

    if (!deps.db) {
      return reply.status(503).send({ error: "db_unavailable" });
    }

    const deviceToken = request.headers["x-device-token"];
    const deviceKey = typeof deviceToken === "string" ? deviceToken : null;

    // ADR-0018 red-team amendment (C-9, CGNAT): the device-keyed guard
    // is the real limit (2); the IP guard is only a coarse ceiling
    // (>=50) so one misbehaving client can't starve an entire CGNAT
    // pool, but a true abuser is still bounded.
    const ipAllowed = await deps.ipGuard.acquire(request.ip);
    if (!ipAllowed) {
      return reply.status(429).send({ error: "too_many_connections", scope: "ip" });
    }
    let deviceAllowed = true;
    if (deviceKey) {
      deviceAllowed = await deps.deviceGuard.acquire(deviceKey);
    }
    if (!deviceAllowed) {
      await deps.ipGuard.release(request.ip);
      return reply.status(429).send({ error: "too_many_connections", scope: "device" });
    }

    const release = async (): Promise<void> => {
      await deps.ipGuard.release(request.ip);
      if (deviceKey) await deps.deviceGuard.release(deviceKey);
    };

    const [submission] = await deps.db
      .select({ status: schema.submissions.status, updatedAt: schema.submissions.updatedAt })
      .from(schema.submissions)
      .where(eq(schema.submissions.id, submissionId))
      .limit(1);

    if (!submission) {
      await release();
      return reply.status(404).send({ error: "not_found" });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": NO_STORE_CACHE_CONTROL,
      Connection: "keep-alive",
    });

    let closed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let deadline: NodeJS.Timeout | null = null;

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
      if (unsubscribe) await unsubscribe().catch(() => {});
      await release();
      res.end();
    };

    request.raw.on("close", () => {
      void close();
    });

    // ADR-0018 §SSE: "sends the current state from Postgres first (so
    // a late subscriber never misses the terminal state)". Last-Event-
    // ID resume replays submission_events, not a bare current-state
    // snapshot, so the client's dedup-by-id sees the gap filled.
    const lastEventId = request.headers["last-event-id"];
    const resumeFrom = typeof lastEventId === "string" ? lastEventId : undefined;

    if (resumeFrom) {
      const [anchor] = await deps.db
        .select({ eventId: schema.submissionEvents.eventId })
        .from(schema.submissionEvents)
        .where(eq(schema.submissionEvents.eventId, resumeFrom))
        .limit(1);

      // IMPORTANT: comparing against `anchor.occurredAt` as a JS `Date`
      // (millisecond resolution) loses the microsecond precision
      // Postgres's `timestamptz` actually stores — round-tripping the
      // anchor's own timestamp back out as a parameter can then compare
      // as LESS than the anchor row's real stored value, making `gt`
      // true for the anchor event itself and re-sending it (verified
      // empirically: this was the exact bug the first version of this
      // query had). A correlated subquery keeps the comparison entirely
      // inside Postgres, at full precision, and `ne(eventId, resumeFrom)`
      // is a belt-and-suspenders exclusion against the (currently
      // impossible, since eventId is unique) case of a timestamp tie.
      const replayRows = anchor
        ? await deps.db
            .select()
            .from(schema.submissionEvents)
            .where(
              and(
                eq(schema.submissionEvents.submissionId, submissionId),
                ne(schema.submissionEvents.eventId, resumeFrom),
                gt(
                  schema.submissionEvents.occurredAt,
                  sql`(select occurred_at from submission_events where event_id = ${resumeFrom})`,
                ),
              ),
            )
            .orderBy(schema.submissionEvents.occurredAt)
        : await deps.db
            .select()
            .from(schema.submissionEvents)
            .where(eq(schema.submissionEvents.submissionId, submissionId))
            .orderBy(schema.submissionEvents.occurredAt);

      for (const row of replayRows) {
        res.write(sseEvent(row.payload, row.eventId));
      }
    } else {
      res.write(sseEvent({ status: submission.status, updatedAt: submission.updatedAt.toISOString() }));
    }

    if (TERMINAL_STATUSES.includes(submission.status)) {
      await close();
      return;
    }

    unsubscribe = await deps.pubsub.subscribe(`sub:${submissionId}`, (message) => {
      if (closed) return;
      let parsed: { event_id?: string | null; status?: string } = {};
      try {
        parsed = JSON.parse(message) as typeof parsed;
      } catch {
        // Malformed pub/sub payload — ignore rather than crash the
        // stream (at-most-once delivery means Postgres replay on
        // reconnect is the real source of truth anyway).
      }
      res.write(sseEvent(parsed, parsed.event_id ?? undefined));
      if (parsed.status && TERMINAL_STATUSES.includes(parsed.status as SubmissionStatus)) {
        void close();
      }
    });

    heartbeat = setInterval(() => {
      if (!closed) res.write(": heartbeat\n\n");
    }, heartbeatMs);

    deadline = setTimeout(() => {
      void close();
    }, maxDurationMs);
  });
}
