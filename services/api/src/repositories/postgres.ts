import type {
  BillingProvider,
  Check,
  EntitlementTier,
  FeedItem,
  Submission,
  TrendingItem,
  WaitlistSignupInput,
  WaitlistSignupResult,
} from "@fact-checker-ke/core";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { generateDeviceToken, hashDeviceToken } from "../lib/device-token.js";
import { deriveTrendingStatus } from "../lib/trending-status.js";
import type {
  CheckRepository,
  DeviceTokenRepository,
  EntitlementRecord,
  EntitlementRepository,
  RepoResult,
  SubmissionRepository,
  TrendingRepository,
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
  trending: TrendingRepository;
  waitlist: WaitlistRepository;
  deviceTokens: DeviceTokenRepository;
  entitlements: EntitlementRepository;
  db: Database;
  close: () => Promise<void>;
} {
  const { db, close } = createDb(connectionString);
  return {
    submissions: new PostgresSubmissionRepository(db),
    checks: new PostgresCheckRepository(db),
    trending: new PostgresTrendingRepository(db),
    waitlist: new PostgresWaitlistRepository(db),
    deviceTokens: new PostgresDeviceTokenRepository(db),
    entitlements: new PostgresEntitlementRepository(db),
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

    const [claimRows, sourceRowsRaw, evidenceRows] = await Promise.all([
      this.db.select().from(schema.claims).where(eq(schema.claims.checkId, id)),
      // The cited sources, via the check_evidence <-> sources join (same
      // pattern as listPublished). The orchestrator persists one `sources`
      // row + one `check_evidence` row per cited source (ADR-0031
      // AT-0031-1), so this resolves every `evidence[].sourceId` to its
      // url/publisher for display.
      this.db
        .select()
        .from(schema.sources)
        .innerJoin(schema.checkEvidence, eq(schema.checkEvidence.sourceId, schema.sources.id))
        .where(eq(schema.checkEvidence.checkId, id)),
      this.db.select().from(schema.checkEvidence).where(eq(schema.checkEvidence.checkId, id)),
    ]);
    // Dedup: a source cited by more than one evidence row appears once.
    const sourceRows = Array.from(
      new Map(sourceRowsRaw.map((r) => [r.sources.id, r.sources])).values(),
    );

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
        context: checkRow.context,
        riskTier: checkRow.riskTier,
        viralityScore: checkRow.viralityScore === null ? null : Number(checkRow.viralityScore),
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

    return this.hydrateFeedItems(checkRows);
  }

  async listTopViral(opts: { limit: number }): Promise<FeedItem[]> {
    // Feed-quality (virality): top published checks by virality score, nulls
    // EXCLUDED (not ranked as zero), ties broken by recency — served by the
    // partial index `checks_published_virality_idx`.
    const checkRows = await this.db
      .select()
      .from(schema.checks)
      .where(
        and(
          eq(schema.checks.isDraft, false),
          isNotNull(schema.checks.publishedAt),
          isNotNull(schema.checks.viralityScore),
        ),
      )
      .orderBy(desc(schema.checks.viralityScore), desc(schema.checks.publishedAt))
      .limit(opts.limit);

    return this.hydrateFeedItems(checkRows);
  }

  /** Resolve the `check_evidence` <-> `sources` join for a set of check rows
   * and project each to a `FeedItem`, preserving the input order. Shared by
   * `listPublished` (descending feed) and `listTopViral` (most-viral section)
   * so the two read paths can never drift in their projection. */
  private async hydrateFeedItems(checkRows: (typeof schema.checks.$inferSelect)[]): Promise<FeedItem[]> {
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
      context: row.context,
      publishedAt: toIsoString(row.publishedAt as Date),
      viralityScore: row.viralityScore === null ? null : Number(row.viralityScore),
      sources: sourcesByCheckId.get(row.id) ?? [],
    }));
  }
}

/**
 * "Trending / under review" stream. Reads SUBMISSIONS (not checks) so a
 * fetch-DISCOVERED viral item is surfaced BEFORE/without a published check.
 * Two bounded queries (mirrors `hydrateFeedItems`): the fetch submissions
 * page, then their own checks — joined in JS so the status derivation
 * (`deriveTrendingStatus`) is the single shared mapping the in-memory repo
 * also uses, and the discovered item's metadata is never conflated with a
 * draft's (unexposed) verdict content.
 */
export class PostgresTrendingRepository implements TrendingRepository {
  constructor(private readonly db: Database) {}

  async listTrending(opts: { limit: number }): Promise<TrendingItem[]> {
    // Fetch-sourced discoveries ranked by virality DESC NULLS LAST, ties by
    // observation recency — served by the partial index
    // `submissions_fetch_trending_idx`. `desc()` alone would be NULLS FIRST in
    // Postgres, so the ordering is spelled out to match the index + contract.
    const subRows = await this.db
      .select({
        id: schema.submissions.id,
        text: schema.submissions.text,
        platform: schema.submissions.platform,
        sourceUrl: schema.submissions.sourceUrl,
        engagement: schema.submissions.engagement,
        viralityScore: schema.submissions.viralityScore,
        status: schema.submissions.status,
        createdAt: schema.submissions.createdAt,
      })
      .from(schema.submissions)
      .where(eq(schema.submissions.ingestSource, "fetch"))
      .orderBy(sql`${schema.submissions.viralityScore} desc nulls last`, desc(schema.submissions.createdAt))
      .limit(opts.limit);

    if (subRows.length === 0) return [];

    const submissionIds = subRows.map((s) => s.id);
    const checkRows = await this.db
      .select({
        id: schema.checks.id,
        submissionId: schema.checks.submissionId,
        isDraft: schema.checks.isDraft,
        publishedAt: schema.checks.publishedAt,
        createdAt: schema.checks.createdAt,
      })
      .from(schema.checks)
      .where(inArray(schema.checks.submissionId, submissionIds));

    // Pick the single most relevant check per submission: a PUBLISHED check
    // wins (the assessment is public and linkable), else the latest by
    // createdAt (e.g. a held draft). Mirrors `deriveTrendingStatus`'s
    // precedence so the chosen pointer and the derived status agree.
    const bestCheckBySubmission = new Map<string, (typeof checkRows)[number]>();
    for (const c of checkRows) {
      const current = bestCheckBySubmission.get(c.submissionId);
      if (!current) {
        bestCheckBySubmission.set(c.submissionId, c);
        continue;
      }
      const cPublished = !c.isDraft && c.publishedAt !== null;
      const curPublished = !current.isDraft && current.publishedAt !== null;
      if (cPublished && !curPublished) {
        bestCheckBySubmission.set(c.submissionId, c);
      } else if (cPublished === curPublished && c.createdAt > current.createdAt) {
        bestCheckBySubmission.set(c.submissionId, c);
      }
    }

    return subRows.map((row) => {
      const best = bestCheckBySubmission.get(row.id) ?? null;
      const pointer = best
        ? { checkId: best.id, isDraft: best.isDraft, publishedAt: best.publishedAt ? toIsoString(best.publishedAt) : null }
        : null;
      const { status, checkId } = deriveTrendingStatus(row.status, pointer);
      return {
        submissionId: row.id,
        // The fetch submission's `text` is the discovered claim/video title
        // (youtube_fetch_source.py sets it to "title\ndescription"). It is
        // always present for a fetch row (the XOR constraint: fetch is a
        // text submission), but guard defensively.
        title: row.text ?? "",
        platform: row.platform,
        sourceUrl: row.sourceUrl,
        viralityScore: row.viralityScore === null ? null : Number(row.viralityScore),
        engagement: row.engagement ?? null,
        ingestSource: "fetch" as const,
        status,
        checkId,
        observedAt: toIsoString(row.createdAt),
        publishedAt: status === "published" ? pointer?.publishedAt ?? null : null,
      };
    });
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

/**
 * ADR-0012 §3: server-authoritative entitlements, backed by the
 * `entitlements` / `billing_events` tables (migration 0017).
 */
export class PostgresEntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: Database) {}

  async getLatestForDevice(deviceTokenHash: string): Promise<EntitlementRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.deviceTokenHash, deviceTokenHash))
      .orderBy(desc(schema.entitlements.createdAt))
      .limit(1);
    return row ? rowToEntitlementRecord(row) : null;
  }

  async recordBillingEvent(input: {
    provider: BillingProvider;
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ firstTime: boolean }> {
    // `on conflict do nothing` on (provider, event_id) + checking the
    // returned row count is the race-free dedup, same pattern as the
    // waitlist join above and the processed_messages inbox.
    const inserted = await this.db
      .insert(schema.billingEvents)
      .values({
        provider: input.provider,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload as object,
      })
      .onConflictDoNothing({ target: [schema.billingEvents.provider, schema.billingEvents.eventId] })
      .returning({ id: schema.billingEvents.id });
    return { firstTime: inserted.length > 0 };
  }

  async activateDeviceEntitlement(input: {
    deviceTokenHash: string;
    tier: EntitlementTier;
    provider: BillingProvider;
    providerRef: string | null;
    currentPeriodEnd: Date | null;
  }): Promise<RepoResult<EntitlementRecord>> {
    // Upsert on (provider, provider_ref) so a webhook replay updates the
    // one row rather than inserting a duplicate — relies on the partial
    // unique index `entitlements_provider_ref_idx` (NULL refs excluded, so
    // this path requires a non-null ref; a null-ref manual comp is a
    // different, admin-only path not exposed here).
    if (input.providerRef === null) {
      return {
        ok: false,
        error: { kind: "internal", message: "activateDeviceEntitlement requires a non-null providerRef" },
      };
    }
    const [row] = await this.db
      .insert(schema.entitlements)
      .values({
        deviceTokenHash: input.deviceTokenHash,
        tier: input.tier,
        status: "active",
        provider: input.provider,
        providerRef: input.providerRef,
        currentPeriodEnd: input.currentPeriodEnd,
      })
      .onConflictDoUpdate({
        target: [schema.entitlements.provider, schema.entitlements.providerRef],
        // The unique index is PARTIAL (`WHERE provider_ref IS NOT NULL`), so
        // the ON CONFLICT arbiter must repeat that predicate to match it —
        // without `targetWhere`, Postgres errors "no unique or exclusion
        // constraint matching the ON CONFLICT specification" (verified
        // empirically against the real DB — the in-memory double hid it).
        targetWhere: sql`${schema.entitlements.providerRef} is not null`,
        set: {
          deviceTokenHash: input.deviceTokenHash,
          tier: input.tier,
          status: "active",
          currentPeriodEnd: input.currentPeriodEnd,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) {
      return { ok: false, error: { kind: "internal", message: "entitlement upsert returned no row" } };
    }
    return { ok: true, value: rowToEntitlementRecord(row) };
  }

  async sweepExpired(now: Date = new Date()): Promise<{ expired: number }> {
    // Bulk, set-based transition (not a per-row loop) — the index on
    // nothing special here, but it's a single UPDATE so even a full scan is
    // one round-trip. `RETURNING id` lets us count exactly what we flipped.
    // Comparing against the passed `now` (default: wall clock) rather than
    // SQL now() keeps this deterministic under an injected clock in tests.
    const rows = await this.db
      .update(schema.entitlements)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(schema.entitlements.status, "active"),
          isNotNull(schema.entitlements.currentPeriodEnd),
          lt(schema.entitlements.currentPeriodEnd, now),
        ),
      )
      .returning({ id: schema.entitlements.id });
    return { expired: rows.length };
  }

  async putPendingSubject(input: {
    provider: BillingProvider;
    reference: string;
    deviceTokenHash: string;
  }): Promise<void> {
    await this.db
      .insert(schema.pendingCheckoutSubjects)
      .values({
        provider: input.provider,
        reference: input.reference,
        deviceTokenHash: input.deviceTokenHash,
      })
      .onConflictDoUpdate({
        target: [schema.pendingCheckoutSubjects.provider, schema.pendingCheckoutSubjects.reference],
        set: { deviceTokenHash: input.deviceTokenHash, createdAt: new Date() },
      });
  }

  async getPendingSubject(input: { provider: BillingProvider; reference: string }): Promise<string | null> {
    const [row] = await this.db
      .select({ deviceTokenHash: schema.pendingCheckoutSubjects.deviceTokenHash })
      .from(schema.pendingCheckoutSubjects)
      .where(
        and(
          eq(schema.pendingCheckoutSubjects.provider, input.provider),
          eq(schema.pendingCheckoutSubjects.reference, input.reference),
        ),
      )
      .limit(1);
    return row?.deviceTokenHash ?? null;
  }

  async prunePendingCheckouts(olderThan: Date): Promise<{ pruned: number }> {
    const rows = await this.db
      .delete(schema.pendingCheckoutSubjects)
      .where(lt(schema.pendingCheckoutSubjects.createdAt, olderThan))
      .returning({ reference: schema.pendingCheckoutSubjects.reference });
    return { pruned: rows.length };
  }
}

function rowToEntitlementRecord(row: typeof schema.entitlements.$inferSelect): EntitlementRecord {
  return {
    id: row.id,
    deviceTokenHash: row.deviceTokenHash,
    userId: row.userId,
    tier: row.tier,
    status: row.status,
    provider: row.provider,
    providerRef: row.providerRef,
    currentPeriodEnd: row.currentPeriodEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Re-exported for integration tests that need to assert row counts directly. */
export { sql };
