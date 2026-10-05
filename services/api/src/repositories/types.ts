import type { Check, FeedItem, Submission, WaitlistSignupInput, WaitlistSignupResult } from "@fact-checker-ke/core";

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
  /**
   * The latest check for a submission (newest by `createdAt`), as a thin
   * pointer for `GET /v1/submissions/:id` — just the real check id and
   * whether it is public yet. Null when no check exists (in-flight, or a
   * `failed` dead-end). Deliberately NOT the full `Check` (no claims/
   * sources/evidence joins): the tracker only needs to know where to link
   * and whether the result is published vs. held for review.
   */
  getLatestForSubmission(submissionId: string): Promise<{ id: string; published: boolean } | null>;
  /**
   * ADR-0032 payoff: recently PUBLISHED checks (`isDraft=false AND
   * publishedAt IS NOT NULL`), newest first — the "what we're checking
   * now" feed. `cursor` is the previous page's last item's `publishedAt`
   * (a keyset cursor, not an offset, so it stays correct under
   * concurrent inserts); omit it for the first page.
   */
  listPublished(opts: { limit: number; cursor?: string | null }): Promise<FeedItem[]>;
  /**
   * Feed-quality (virality): the top-N PUBLISHED checks by `viralityScore`
   * DESC — the "most viral right now" section. Rows with a null virality score
   * (every submission-sourced check, and fetch checks predating the field) are
   * EXCLUDED, not ranked as zero; ties are broken by `publishedAt` DESC. This
   * is computed over ALL published rows, not a keyset page, and is additive to
   * `listPublished` — the descending feed is unchanged.
   */
  listTopViral(opts: { limit: number }): Promise<FeedItem[]>;
}

export interface WaitlistRepository {
  /**
   * Inserts a signup, idempotent on normalised email. Returns
   * `{status:"joined"}` on first insert, `{status:"already_joined"}` if
   * the email already exists — never an error for the duplicate case,
   * since that's an expected, successful outcome for the caller.
   */
  join(input: WaitlistSignupInput): Promise<RepoResult<WaitlistSignupResult>>;
}

/**
 * ADR-0020 §1 (anonymous-token slice). Issues and validates the opaque
 * device token that is the quota/stream-concurrency key everywhere else
 * in the codebase (never the bare IP).
 */
export interface DeviceTokenRepository {
  /** Issues a new token and persists only its hash. */
  issue(): Promise<{ token: string; createdAt: string }>;
  /**
   * Verifies `token` exists (by hash) and bumps `last_seen_at`. A device
   * token that was never issued (or was rotated away, per AT-0020-5) is
   * `not_found` — the caller treats that as "start a fresh identity",
   * never as an error that blocks the request.
   */
  touch(token: string): Promise<RepoResult<{ tokenHash: string }>>;
}
