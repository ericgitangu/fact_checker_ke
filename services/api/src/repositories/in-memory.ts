import { randomUUID } from "node:crypto";
import type {
  BillingProvider,
  Check,
  EntitlementTier,
  FeedItem,
  IngestSource,
  Submission,
  WaitlistSignupInput,
  WaitlistSignupResult,
} from "@fact-checker-ke/core";
import { generateDeviceToken, hashDeviceToken } from "../lib/device-token.js";
import type {
  CheckRepository,
  DeviceTokenRepository,
  EntitlementRecord,
  EntitlementRepository,
  RepoResult,
  SubmissionRepository,
  WaitlistRepository,
} from "./types.js";

/**
 * In-memory implementation used for the skeleton and tests. Not safe across
 * multiple instances/processes — swap for a Postgres-backed implementation
 * (see db/migrations) before any real deployment. Flagged as tech debt in
 * the scaffold report; tracked here rather than buried silently.
 */
export class InMemorySubmissionRepository implements SubmissionRepository {
  private readonly store = new Map<string, Submission>();

  /**
   * Directly inserts a fully-formed `Submission` — used by
   * `InMemorySubmissionService` so the dev/test POST and GET paths
   * share one store (not two independent ones) even outside Postgres,
   * where the real path is one transaction against one table.
   */
  insert(submission: Submission): void {
    this.store.set(submission.id, submission);
  }

  async create(input: {
    url: string | null;
    text: string | null;
    submittedBy: string | null;
  }): Promise<Submission> {
    const now = new Date().toISOString();
    const submission: Submission = {
      id: randomUUID(),
      url: input.url,
      text: input.text,
      submittedBy: input.submittedBy,
      status: "received",
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(submission.id, submission);
    return submission;
  }

  async getById(id: string): Promise<RepoResult<Submission>> {
    const found = this.store.get(id);
    if (!found) {
      return { ok: false, error: { kind: "not_found", message: `Submission ${id} not found` } };
    }
    return { ok: true, value: found };
  }
}

export class InMemoryCheckRepository implements CheckRepository {
  private readonly store = new Map<string, Check>();
  // Not on the shared `Check` type (see packages/core/src/schemas/feed.ts
  // docblock on `IngestSourceSchema`) — tracked alongside the store only
  // so `seed()` callers (tests, dev fallback) can exercise `listPublished`
  // without every other `Check` literal in the codebase needing a new
  // required field.
  private readonly ingestSourceByCheckId = new Map<string, IngestSource>();

  seed(check: Check, ingestSource: IngestSource = "submission"): void {
    this.store.set(check.id, check);
    this.ingestSourceByCheckId.set(check.id, ingestSource);
  }

  async getById(id: string): Promise<RepoResult<Check>> {
    const found = this.store.get(id);
    if (!found) {
      return { ok: false, error: { kind: "not_found", message: `Check ${id} not found` } };
    }
    return { ok: true, value: found };
  }

  async getLatestForSubmission(submissionId: string): Promise<{ id: string; published: boolean } | null> {
    const latest = [...this.store.values()]
      .filter((c) => c.submissionId === submissionId)
      .sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string))[0];
    if (!latest) return null;
    return { id: latest.id, published: !latest.isDraft && latest.publishedAt !== null };
  }

  async listPublished(opts: { limit: number; cursor?: string | null }): Promise<FeedItem[]> {
    const published = [...this.store.values()]
      .filter((c) => !c.isDraft && c.publishedAt !== null)
      .sort((a, b) => (b.publishedAt as string).localeCompare(a.publishedAt as string));

    const afterCursor = opts.cursor
      ? published.filter((c) => (c.publishedAt as string) < (opts.cursor as string))
      : published;

    return afterCursor.slice(0, opts.limit).map((check) => this.toFeedItem(check));
  }

  async listTopViral(opts: { limit: number }): Promise<FeedItem[]> {
    // Feed-quality (virality): published checks with a non-null virality score,
    // highest first, nulls EXCLUDED, ties broken by recency — mirrors the
    // postgres repo's `listTopViral` ordering so the two back the same route.
    return [...this.store.values()]
      .filter((c) => !c.isDraft && c.publishedAt !== null && (c.viralityScore ?? null) !== null)
      .sort((a, b) => {
        const byViral = (b.viralityScore as number) - (a.viralityScore as number);
        return byViral !== 0 ? byViral : (b.publishedAt as string).localeCompare(a.publishedAt as string);
      })
      .slice(0, opts.limit)
      .map((check) => this.toFeedItem(check));
  }

  private toFeedItem(check: Check): FeedItem {
    return {
      id: check.id,
      claim: check.summary,
      rating: check.rating as FeedItem["rating"],
      calibratedConfidence: check.calibratedConfidence,
      ingestSource: this.ingestSourceByCheckId.get(check.id) ?? "submission",
      riskTier: check.riskTier,
      whatWouldChangeThis: check.whatWouldChangeThis,
      context: check.context,
      publishedAt: check.publishedAt as string,
      viralityScore: check.viralityScore ?? null,
      sources: check.evidence
        .map((item) => {
          const source = check.sources.find((s) => s.id === item.sourceId);
          if (!source) return null;
          return {
            sourceId: item.sourceId,
            quote: item.quote,
            url: source.url,
            title: source.title,
            publisher: source.publisher,
            credibilityTier: source.credibilityTier,
          };
        })
        .filter((s): s is FeedItem["sources"][number] => s !== null),
    };
  }
}

export class InMemoryWaitlistRepository implements WaitlistRepository {
  private readonly emails = new Set<string>();

  async join(input: WaitlistSignupInput): Promise<RepoResult<WaitlistSignupResult>> {
    if (this.emails.has(input.email)) {
      return { ok: true, value: { status: "already_joined" } };
    }
    this.emails.add(input.email);
    return { ok: true, value: { status: "joined" } };
  }
}

export class InMemoryDeviceTokenRepository implements DeviceTokenRepository {
  private readonly hashes = new Set<string>();

  async issue(): Promise<{ token: string; createdAt: string }> {
    const { token, tokenHash } = generateDeviceToken();
    this.hashes.add(tokenHash);
    return { token, createdAt: new Date().toISOString() };
  }

  async touch(token: string): Promise<RepoResult<{ tokenHash: string }>> {
    const tokenHash = hashDeviceToken(token);
    if (!this.hashes.has(tokenHash)) {
      return { ok: false, error: { kind: "not_found", message: "device token not recognised" } };
    }
    return { ok: true, value: { tokenHash } };
  }
}

/**
 * ADR-0012 §3: in-memory entitlements for unit tests and local dev (no
 * DATABASE_URL). Same "not durable, test/dev only" caveat as the other
 * in-memory repos above. Keyed exactly like the Postgres repo:
 * `(provider, providerRef)` for webhook idempotency, device token hash for
 * the read path, and `(provider, eventId)` for webhook-event dedup.
 */
export class InMemoryEntitlementRepository implements EntitlementRepository {
  private readonly records: EntitlementRecord[] = [];
  private readonly seenEvents = new Set<string>();

  async getLatestForDevice(deviceTokenHash: string): Promise<EntitlementRecord | null> {
    const matches = this.records
      .filter((r) => r.deviceTokenHash === deviceTokenHash)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async recordBillingEvent(input: {
    provider: BillingProvider;
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ firstTime: boolean }> {
    const key = `${input.provider}:${input.eventId}`;
    if (this.seenEvents.has(key)) return { firstTime: false };
    this.seenEvents.add(key);
    return { firstTime: true };
  }

  async activateDeviceEntitlement(input: {
    deviceTokenHash: string;
    tier: EntitlementTier;
    provider: BillingProvider;
    providerRef: string | null;
    currentPeriodEnd: Date | null;
  }): Promise<RepoResult<EntitlementRecord>> {
    const now = new Date();
    // Upsert on (provider, providerRef) when a ref is present, mirroring
    // the partial unique index in Postgres.
    const existing =
      input.providerRef !== null
        ? this.records.find((r) => r.provider === input.provider && r.providerRef === input.providerRef)
        : undefined;
    if (existing) {
      existing.status = "active";
      existing.tier = input.tier;
      existing.deviceTokenHash = input.deviceTokenHash;
      existing.currentPeriodEnd = input.currentPeriodEnd;
      existing.updatedAt = now;
      return { ok: true, value: existing };
    }
    const created: EntitlementRecord = {
      id: randomUUID(),
      deviceTokenHash: input.deviceTokenHash,
      userId: null,
      tier: input.tier,
      status: "active",
      provider: input.provider,
      providerRef: input.providerRef,
      currentPeriodEnd: input.currentPeriodEnd,
      createdAt: now,
      updatedAt: now,
    };
    this.records.push(created);
    return { ok: true, value: created };
  }
}
