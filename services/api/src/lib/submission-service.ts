import { randomUUID } from "node:crypto";
import { schema, type Database } from "@fact-checker-ke/db";
import { SubmissionReceivedEventSchema } from "@fact-checker-ke/core";
import {
  decideIdempotency,
  findIdempotencyKey,
  IdempotencyRaceLostError,
  type IdempotencyPreCheck,
} from "./idempotency.js";
import { writeOutboxEvent, publishOutboxRowInline } from "./outbox.js";
import type { Publisher } from "./publisher.js";
import { signCapabilityToken } from "./device-token.js";

export type SubmissionCreateInput = {
  idempotencyKey: string;
  requestHash: string;
  submission: { url: string | null; text: string | null; submittedBy: string | null };
};

/**
 * ADR-0018 §SSE: "streams only for submissions the caller created (a
 * capability token in the 202 response)". `eventsToken` is minted once,
 * at creation time, and stored VERBATIM in the idempotency response
 * body — a replay must return the same token, not a freshly re-signed
 * one with a different `exp`.
 */
export type SubmissionCreateBody = { id: string; eventsToken: string };

export type SubmissionCreateOutcome =
  | { kind: "created"; status: 202; body: SubmissionCreateBody }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" };

export interface SubmissionService {
  createWithIdempotency(input: SubmissionCreateInput): Promise<SubmissionCreateOutcome>;
}

/**
 * ADR-0017 §1-2: submission insert + idempotency-key row + outbox row,
 * all in one transaction, then the inline relay (publish to QStash)
 * BEFORE this function returns — red-team Amendment #3 — so a 202
 * response always means "the event is already in flight," never
 * "queued for a sweeper that might not run for up to an hour."
 */
export class PostgresSubmissionService implements SubmissionService {
  constructor(
    private readonly db: Database,
    private readonly preCheck: IdempotencyPreCheck,
    private readonly publisher: Publisher,
    private readonly analyzeHopUrl: string,
    private readonly capabilityTokenSecret: string,
  ) {}

  async createWithIdempotency(input: SubmissionCreateInput): Promise<SubmissionCreateOutcome> {
    // Advisory only (see lib/idempotency.ts docblock) — never gates the
    // authoritative Postgres decision below.
    await this.preCheck.seen(input.idempotencyKey);

    const existing = await findIdempotencyKey(this.db, input.idempotencyKey);
    if (existing) {
      const decision = decideIdempotency(existing, input.requestHash);
      return decision.kind === "replay"
        ? { kind: "replay", status: decision.status, body: decision.body }
        : { kind: "conflict" };
    }

    let outboxRowId: string | null = null;
    let created: SubmissionCreateBody | null = null;

    try {
      await this.db.transaction(async (tx) => {
        const [submissionRow] = await tx
          .insert(schema.submissions)
          .values({
            url: input.submission.url,
            text: input.submission.text,
            submittedBy: input.submission.submittedBy,
          })
          .returning();
        if (!submissionRow) throw new Error("Insert into submissions returned no row");

        const eventsToken = await signCapabilityToken(this.capabilityTokenSecret, submissionRow.id);
        const responseBody: SubmissionCreateBody = { id: submissionRow.id, eventsToken };

        const inserted = await tx
          .insert(schema.idempotencyKeys)
          .values({
            key: input.idempotencyKey,
            requestHash: input.requestHash,
            responseStatus: 202,
            responseBody,
          })
          .onConflictDoNothing({ target: schema.idempotencyKeys.key })
          .returning({ key: schema.idempotencyKeys.key });

        if (inserted.length === 0) {
          // Lost the race to a concurrent identical-key request — abort
          // the whole transaction (including this submission insert).
          throw new IdempotencyRaceLostError(input.idempotencyKey);
        }

        const event = SubmissionReceivedEventSchema.parse({
          event_id: randomUUID(),
          occurred_at: new Date().toISOString(),
          submission_id: submissionRow.id,
          org_id: submissionRow.orgId,
          event_type: "submission.received",
          schema_version: "v1",
          payload: {
            url: submissionRow.url,
            text: submissionRow.text,
            submitted_by: submissionRow.submittedBy,
          },
        });

        const [outboxRow] = await tx
          .insert(schema.outbox)
          .values({
            aggregateType: "submission",
            aggregateId: submissionRow.id,
            eventType: event.event_type,
            payload: event,
          })
          .returning({ id: schema.outbox.id });
        if (!outboxRow) throw new Error("Insert into outbox returned no row");

        await tx.insert(schema.submissionEvents).values({
          submissionId: submissionRow.id,
          eventId: event.event_id,
          eventType: event.event_type,
          payload: event,
        });

        outboxRowId = outboxRow.id;
        created = responseBody;
      });
    } catch (err) {
      if (err instanceof IdempotencyRaceLostError) {
        const winner = await findIdempotencyKey(this.db, input.idempotencyKey);
        if (!winner) {
          // Extremely unlikely (the winner's commit should already be
          // visible by the time our insert conflicted against it), but
          // fail loudly rather than guess.
          throw new Error(`Idempotency race lost for ${input.idempotencyKey} but no winner row found`);
        }
        const decision = decideIdempotency(winner, input.requestHash);
        return decision.kind === "replay"
          ? { kind: "replay", status: decision.status, body: decision.body }
          : { kind: "conflict" };
      }
      throw err;
    }

    if (!created || !outboxRowId) {
      throw new Error("submission transaction committed without producing a result");
    }

    // Inline relay (red-team Amendment #3): publish BEFORE returning.
    // A publish failure here is not fatal to the request — the row
    // stays unpublished and the sweeper (`/internal/outbox/drain`)
    // picks it up on its next pass (ADR-0017 §1 trade-off: "up to one
    // sweep interval of extra latency when the inline publish fails").
    await publishOutboxRowInline(this.db, this.publisher, this.analyzeHopUrl, outboxRowId).catch(() => {
      /* intentionally swallowed — see comment above */
    });

    return { kind: "created", status: 202, body: created };
  }
}

/**
 * Dev/test-only (no DATABASE_URL): mirrors the Postgres service's
 * decision logic (idempotency replay/conflict, one event per
 * submission) without real transactional atomicity, since there is no
 * real Postgres to be atomic against. Atomicity itself is proven only
 * by the Postgres integration tests (ADR-0019) — this class exists so
 * the route's idempotency CONTRACT (replay / conflict / created) has a
 * fast unit-test double, not so the atomicity guarantee can be unit
 * tested without a database.
 */
export class InMemorySubmissionService implements SubmissionService {
  private readonly byKey = new Map<string, { requestHash: string; status: number; body: unknown }>();
  readonly outbox: Array<{ id: string; event: unknown }> = [];

  constructor(
    private readonly publisher: Publisher,
    private readonly analyzeHopUrl: string,
    /**
     * Shares its store with the `SubmissionRepository` the GET route
     * reads from — otherwise POST (via this service) and GET (via the
     * repository) would be two independent in-memory stores, and a
     * freshly-created submission would 404 immediately (only matters
     * outside Postgres, where both paths really are one table).
     */
    private readonly submissionsStore: { insert(submission: import("@fact-checker-ke/core").Submission): void },
    private readonly capabilityTokenSecret: string,
  ) {}

  async createWithIdempotency(input: SubmissionCreateInput): Promise<SubmissionCreateOutcome> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) {
      if (existing.requestHash === input.requestHash) {
        return { kind: "replay", status: existing.status, body: existing.body };
      }
      return { kind: "conflict" };
    }

    const id = randomUUID();
    const eventsToken = await signCapabilityToken(this.capabilityTokenSecret, id);
    const body: SubmissionCreateBody = { id, eventsToken };
    this.byKey.set(input.idempotencyKey, { requestHash: input.requestHash, status: 202, body });

    const now = new Date().toISOString();
    this.submissionsStore.insert({
      id,
      url: input.submission.url,
      text: input.submission.text,
      submittedBy: input.submission.submittedBy,
      status: "received",
      createdAt: now,
      updatedAt: now,
    });

    const event = SubmissionReceivedEventSchema.parse({
      event_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      submission_id: id,
      org_id: "00000000-0000-0000-0000-000000000001",
      event_type: "submission.received",
      schema_version: "v1",
      payload: {
        url: input.submission.url,
        text: input.submission.text,
        submitted_by: input.submission.submittedBy,
      },
    });
    const outboxId = randomUUID();
    this.outbox.push({ id: outboxId, event });
    await this.publisher.publish({ url: this.analyzeHopUrl, body: event, deduplicationId: outboxId }).catch(() => {});

    return { kind: "created", status: 202, body };
  }
}
