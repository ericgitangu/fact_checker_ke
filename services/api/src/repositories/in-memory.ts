import { randomUUID } from "node:crypto";
import type { Check, Submission } from "@fact-checker-ke/core";
import type { CheckRepository, RepoResult, SubmissionRepository } from "./types.js";

/**
 * In-memory implementation used for the skeleton and tests. Not safe across
 * multiple instances/processes — swap for a Postgres-backed implementation
 * (see db/migrations) before any real deployment. Flagged as tech debt in
 * the scaffold report; tracked here rather than buried silently.
 */
export class InMemorySubmissionRepository implements SubmissionRepository {
  private readonly store = new Map<string, Submission>();

  async create(input: {
    url: string | null;
    text: string | null;
    submittedBy: string | null;
  }): Promise<Submission> {
    const submission: Submission = {
      id: randomUUID(),
      url: input.url,
      text: input.text,
      submittedBy: input.submittedBy,
      status: "received",
      createdAt: new Date().toISOString(),
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
