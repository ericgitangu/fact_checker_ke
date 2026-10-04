import { randomUUID } from "node:crypto";
import type {
  Check,
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

  async listPublished(opts: { limit: number; cursor?: string | null }): Promise<FeedItem[]> {
    const published = [...this.store.values()]
      .filter((c) => !c.isDraft && c.publishedAt !== null)
      .sort((a, b) => (b.publishedAt as string).localeCompare(a.publishedAt as string));

    const afterCursor = opts.cursor
      ? published.filter((c) => (c.publishedAt as string) < (opts.cursor as string))
      : published;

    return afterCursor.slice(0, opts.limit).map((check) => ({
      id: check.id,
      claim: check.summary,
      rating: check.rating as FeedItem["rating"],
      calibratedConfidence: check.calibratedConfidence,
      ingestSource: this.ingestSourceByCheckId.get(check.id) ?? "submission",
      riskTier: check.riskTier,
      whatWouldChangeThis: check.whatWouldChangeThis,
      publishedAt: check.publishedAt as string,
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
    }));
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
