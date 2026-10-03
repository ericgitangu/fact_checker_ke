import type { Check, Submission, WaitlistSignupInput, WaitlistSignupResult } from "@fact-checker-ke/core";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { eq, sql } from "drizzle-orm";
import { generateDeviceToken, hashDeviceToken } from "../lib/device-token.js";
import type {
  CheckRepository,
  DeviceTokenRepository,
  RepoResult,
  SubmissionRepository,
  WaitlistRepository,
} from "./types.js";

/**
 * Shared Postgres connection for all repos in a given process. `postgres`
 * (postgres.js) is driven in `max: 1` mode against Neon's POOLED
 * endpoint — see @fact-checker-ke/db client.ts for the rationale.
 */
export function createPostgresRepositories(connectionString: string): {
  submissions: SubmissionRepository;
  checks: CheckRepository;
  waitlist: WaitlistRepository;
  deviceTokens: DeviceTokenRepository;
  db: Database;
  close: () => Promise<void>;
} {
  const { db, close } = createDb(connectionString);
  return {
    submissions: new PostgresSubmissionRepository(db),
    checks: new PostgresCheckRepository(db),
    waitlist: new PostgresWaitlistRepository(db),
    deviceTokens: new PostgresDeviceTokenRepository(db),
    db,
    close,
  };
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    url: string | null;
    text: string | null;
    submittedBy: string | null;
  }): Promise<Submission> {
    const [row] = await this.db
      .insert(schema.submissions)
      .values({
        url: input.url,
        text: input.text,
        submittedBy: input.submittedBy,
      })
      .returning();

    if (!row) {
      // Postgres guarantees a RETURNING row on a successful single-row
      // insert; this branch is unreachable in practice but keeps the
      // return type honest rather than asserting non-null.
      throw new Error("Insert into submissions returned no row");
    }

    return {
      id: row.id,
      url: row.url,
      text: row.text,
      submittedBy: row.submittedBy,
      status: row.status,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  async getById(id: string): Promise<RepoResult<Submission>> {
    const [row] = await this.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, id))
      .limit(1);

    if (!row) {
      return { ok: false, error: { kind: "not_found", message: `Submission ${id} not found` } };
    }

    return {
      ok: true,
      value: {
        id: row.id,
        url: row.url,
        text: row.text,
        submittedBy: row.submittedBy,
        status: row.status,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
      },
    };
  }
}

export class PostgresCheckRepository implements CheckRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<RepoResult<Check>> {
    const [checkRow] = await this.db
      .select()
      .from(schema.checks)
      .where(eq(schema.checks.id, id))
      .limit(1);

    if (!checkRow) {
      return { ok: false, error: { kind: "not_found", message: `Check ${id} not found` } };
    }

    const [claimRows, sourceRows] = await Promise.all([
      this.db.select().from(schema.claims).where(eq(schema.claims.checkId, id)),
      // Sources aren't linked to a check via a column in the current
      // schema (they're linked implicitly through retrieval, tracked as
      // a schema gap below) — returned empty until that join exists.
      Promise.resolve([] as (typeof schema.sources.$inferSelect)[]),
    ]);

    return {
      ok: true,
      value: {
        id: checkRow.id,
        submissionId: checkRow.submissionId,
        summary: checkRow.summary,
        rating: checkRow.rating,
        isDraft: checkRow.isDraft,
        reviewedBy: checkRow.reviewedBy,
        createdAt: toIsoString(checkRow.createdAt),
        publishedAt: checkRow.publishedAt ? toIsoString(checkRow.publishedAt) : null,
        claims: claimRows.map((c) => ({
          id: c.id,
          checkId: c.checkId,
          text: c.text,
          claimType: c.claimType,
          spanStart: c.spanStart,
          spanEnd: c.spanEnd,
          createdAt: toIsoString(c.createdAt),
        })),
        sources: sourceRows.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          publisher: s.publisher,
          credibilityTier: s.credibilityTier,
          publishedAt: s.publishedAt ? toIsoString(s.publishedAt) : undefined,
          retrievedAt: toIsoString(s.retrievedAt),
          excerpt: s.excerpt ?? undefined,
        })),
      },
    };
  }
}

export class PostgresWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: Database) {}

  async join(input: WaitlistSignupInput): Promise<RepoResult<WaitlistSignupResult>> {
    // `on conflict do nothing` + checking returned row count is the
    // idempotent, race-free way to detect "already joined" — a
    // pre-check SELECT followed by INSERT would have a TOCTOU gap under
    // concurrent signups with the same email.
    const inserted = await this.db
      .insert(schema.waitlistSignups)
      .values({
        email: input.email,
        source: input.source,
        referrer: input.referrer ?? null,
      })
      .onConflictDoNothing({ target: schema.waitlistSignups.email })
      .returning({ id: schema.waitlistSignups.id });

    if (inserted.length === 0) {
      return { ok: true, value: { status: "already_joined" } };
    }
    return { ok: true, value: { status: "joined" } };
  }
}

export class PostgresDeviceTokenRepository implements DeviceTokenRepository {
  constructor(private readonly db: Database) {}

  async issue(): Promise<{ token: string; createdAt: string }> {
    const { token, tokenHash } = generateDeviceToken();
    const [row] = await this.db.insert(schema.deviceTokens).values({ tokenHash }).returning();
    if (!row) throw new Error("Insert into device_tokens returned no row");
    return { token, createdAt: toIsoString(row.createdAt) };
  }

  async touch(token: string): Promise<RepoResult<{ tokenHash: string }>> {
    const tokenHash = hashDeviceToken(token);
    const [row] = await this.db
      .update(schema.deviceTokens)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.deviceTokens.tokenHash, tokenHash))
      .returning();
    if (!row) {
      return { ok: false, error: { kind: "not_found", message: "device token not recognised" } };
    }
    return { ok: true, value: { tokenHash: row.tokenHash } };
  }
}

/** Re-exported for integration tests that need to assert row counts directly. */
export { sql };
