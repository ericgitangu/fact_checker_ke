import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";

/**
 * Deterministic hash of a JSON-serialisable request body, independent of
 * key order (`JSON.stringify` is not: `{a:1,b:2}` and `{b:2,a:1}` would
 * hash differently without this). Used to detect "same Idempotency-Key,
 * different body" (ADR-0017 §2: a 422).
 */
export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * ADR-0017 §2: "Redis is used only as a fast pre-check (SET NX with
 * TTL) to shed obvious duplicates before opening a DB transaction.
 * Postgres is the source of truth." `seen()` is advisory: a false
 * negative (misses a real duplicate) or false positive (Redis evicts/
 * restarts) never produces an incorrect response, because the route
 * always confirms against Postgres regardless of what this returns.
 */
export interface IdempotencyPreCheck {
  seen(key: string): Promise<boolean>;
}

export class NoopIdempotencyPreCheck implements IdempotencyPreCheck {
  async seen(): Promise<boolean> {
    return false;
  }
}

export interface RedisLike {
  set(key: string, value: string, opts: { nx: true; ex: number }): Promise<string | null>;
}

export class RedisIdempotencyPreCheck implements IdempotencyPreCheck {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds = 10,
  ) {}

  async seen(key: string): Promise<boolean> {
    try {
      // @upstash/redis's `set` with `nx` returns null when the key
      // already existed (the write was skipped) — that's "seen".
      const ok = await this.redis.set(`idempotency-precheck:${key}`, "1", { nx: true, ex: this.ttlSeconds });
      return ok === null;
    } catch {
      // Redis outage degrades to "never seen" (fail open to the
      // authoritative Postgres check) — never a 500 for an unrelated
      // Redis blip (ADR-0018: "nothing correctness-critical lives only
      // in Redis").
      return false;
    }
  }
}

export type StoredIdempotencyResponse = {
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
};

export async function findIdempotencyKey(db: Database, key: string): Promise<StoredIdempotencyResponse | null> {
  const [row] = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key)).limit(1);
  if (!row) return null;
  return {
    key: row.key,
    requestHash: row.requestHash,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
  };
}

/**
 * Thrown (and caught by the route) when this transaction lost a race to
 * insert `idempotency_keys` for the same key — i.e. a concurrent request
 * with the identical Idempotency-Key committed first. Causes the whole
 * transaction (including any submission row this attempt inserted) to
 * roll back, so the loser never leaves a duplicate submission behind;
 * the route re-reads the winner's stored response and replays/conflicts
 * against it instead.
 */
export class IdempotencyRaceLostError extends Error {
  constructor(public readonly key: string) {
    super(`Lost idempotency-key insert race for key ${key}`);
  }
}

/** Decision after comparing a stored row's hash against the current request's hash. */
export type IdempotencyDecision =
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" };

export function decideIdempotency(stored: StoredIdempotencyResponse, requestHash: string): IdempotencyDecision {
  if (stored.requestHash === requestHash) {
    return { kind: "replay", status: stored.responseStatus, body: stored.responseBody };
  }
  return { kind: "conflict" };
}
