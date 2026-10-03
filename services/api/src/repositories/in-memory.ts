import { randomUUID } from "node:crypto";
import type { Check, Submission, WaitlistSignupInput, WaitlistSignupResult } from "@fact-checker-ke/core";
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

  seed(check: Check): void {
    this.store.set(check.id, check);
  }

  async getById(id: string): Promise<RepoResult<Check>> {
    const found = this.store.get(id);
    if (!found) {
      return { ok: false, error: { kind: "not_found", message: `Check ${id} not found` } };
    }
    return { ok: true, value: found };
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
