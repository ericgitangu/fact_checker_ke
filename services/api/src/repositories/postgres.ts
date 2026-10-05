import type { Check, FeedItem, Submission, WaitlistSignupInput, WaitlistSignupResult } from "@fact-checker-ke/core";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
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

  async getLatestForSubmission(submissionId: string): Promise<{ id: string; published: boolean } | null> {
    const [row] = await this.db
      .select({ id: schema.checks.id, isDraft: schema.checks.isDraft, publishedAt: schema.checks.publishedAt })
      .from(schema.checks)
      .where(eq(schema.checks.submissionId, submissionId))
      .orderBy(desc(schema.checks.createdAt))
      .limit(1);
    if (!row) return null;
    return { id: row.id, published: !row.isDraft && row.publishedAt !== null };
  }

  async getById(id: string): Promise<RepoResult<Check>> {
    const [checkRow] = await this.db
      .select()
      .from(schema.checks)
      .where(eq(schema.checks.id, id))
      .limit(1);

    if (!checkRow) {
      return { ok: false, error: { kind: "not_found", message: `Check ${id} not found` } };
    }

    const [claimRows, sourceRows, evidenceRows] = await Promise.all([
      this.db.select().from(schema.claims).where(eq(schema.claims.checkId, id)),
      // Sources aren't linked to a check via a column in the current
      // schema (they're linked implicitly through retrieval, tracked as
      // a schema gap below) — returned empty until that join exists.
      Promise.resolve([] as (typeof schema.sources.$inferSelect)[]),
      this.db.select().from(schema.checkEvidence).where(eq(schema.checkEvidence.checkId, id)),
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
        calibratedConfidence: checkRow.calibratedConfidence === null ? null : Number(checkRow.calibratedConfidence),
        whatWouldChangeThis: checkRow.whatWouldChangeThis,
        riskTier: checkRow.riskTier,
        evidence: evidenceRows.map((e) => ({ sourceId: e.sourceId, quote: e.quote })),
        claims: claimRows.map((c) => ({
          id: c.id,
          checkId: c.checkId,
          text: c.text,
          claimType: c.claimType,
          spanStart: c.spanStart,
          spanEnd: c.spanEnd,
          namedPerson: c.namedPerson,
          attribution: c.attribution,
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

  /**
   * ADR-0032 payoff: the "what we're checking now" feed. Two queries
   * (checks page, then the check_evidence<->sources join for that page's
   * ids) rather than one big join — a join would duplicate the check row
   * once per cited source, which is wasted work to de-duplicate back out
   * in JS; two queries bounded by `limit` is the clearer, well-indexed
   * (`checks_org_id_idx` aside, `publishedAt` ordering is scanned —
   * flagged as tech debt below) read pattern for a list endpoint.
   *
   * // TODO(tech-debt): no index on `checks(published_at)` /
   * // `checks(is_draft, published_at)` yet — this scans/sorts without
   * // one. Fine at current row counts; add a migration
   * // (`checks_published_at_idx` partial on `is_draft = false`) once the
   * // feed is real traffic, not before — a new migration was explicitly
   * // out of scope for this change per the task brief ("NO new migration
   * // unless truly required").
   */
  async listPublished(opts: { limit: number; cursor?: string | null }): Promise<FeedItem[]> {
    const whereClauses = [eq(schema.checks.isDraft, false), isNotNull(schema.checks.publishedAt)];
    if (opts.cursor) {
      whereClauses.push(lt(schema.checks.publishedAt, new Date(opts.cursor)));
    }

    const checkRows = await this.db
      .select()
      .from(schema.checks)
      .where(and(...whereClauses))
      .orderBy(desc(schema.checks.publishedAt))
      .limit(opts.limit);

    if (checkRows.length === 0) return [];

    const checkIds = checkRows.map((c) => c.id);
    const evidenceRows = await this.db
      .select({
        checkId: schema.checkEvidence.checkId,
        quote: schema.checkEvidence.quote,
        sourceId: schema.sources.id,
        url: schema.sources.url,
        title: schema.sources.title,
        publisher: schema.sources.publisher,
        credibilityTier: schema.sources.credibilityTier,
      })
      .from(schema.checkEvidence)
      .innerJoin(schema.sources, eq(schema.checkEvidence.sourceId, schema.sources.id))
      .where(inArray(schema.checkEvidence.checkId, checkIds));

    const sourcesByCheckId = new Map<string, FeedItem["sources"]>();
    for (const row of evidenceRows) {
      const list = sourcesByCheckId.get(row.checkId) ?? [];
      list.push({
        sourceId: row.sourceId,
        quote: row.quote,
        url: row.url,
        title: row.title,
        publisher: row.publisher,
        credibilityTier: row.credibilityTier,
      });
      sourcesByCheckId.set(row.checkId, list);
    }

    return checkRows.map((row) => ({
      id: row.id,
      claim: row.summary,
      // Published checks always carry a rating (`checks_published_requires_rating`
      // DB constraint) — the cast is backed by that invariant, not an assumption.
      rating: row.rating as FeedItem["rating"],
      calibratedConfidence: row.calibratedConfidence === null ? null : Number(row.calibratedConfidence),
      ingestSource: row.ingestSource,
      riskTier: row.riskTier,
      whatWouldChangeThis: row.whatWouldChangeThis,
      publishedAt: toIsoString(row.publishedAt as Date),
      sources: sourcesByCheckId.get(row.id) ?? [],
    }));
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
