import type { Check, Submission } from "@fact-checker-ke/core";

/**
 * Result type for repository operations that can fail in an expected way.
 * Errors are values, not thrown exceptions, at this boundary — callers
 * (route handlers) decide the HTTP status from the error `kind`.
 */
export type RepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RepoError };

export type RepoError = { kind: "not_found"; message: string } | { kind: "internal"; message: string };

export interface SubmissionRepository {
  create(input: { url: string | null; text: string | null; submittedBy: string | null }): Promise<Submission>;
  getById(id: string): Promise<RepoResult<Submission>>;
}

export interface CheckRepository {
  getById(id: string): Promise<RepoResult<Check>>;
}
