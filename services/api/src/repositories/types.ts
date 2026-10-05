import type {
  BillingProvider,
  Check,
  EntitlementStatus,
  EntitlementTier,
  FeedItem,
  Submission,
  TrendingItem,
  WaitlistSignupInput,
  WaitlistSignupResult,
} from "@fact-checker-ke/core";

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

export interface TrendingRepository {
  /**
   * "Trending / under review" stream: fetch-DISCOVERED items
   * (`submissions.ingest_source = 'fetch'`), ordered by `viralityScore` DESC
   * NULLS LAST (ties broken by observation recency), each with a derived
   * status (`deriveTrendingStatus`). This reads SUBMISSIONS (not checks), so a
   * viral item is surfaced BEFORE/without a published check — the whole point
   * of the stream. It NEVER exposes a held draft's rating/summary: only the
   * discovered video's own metadata plus the derived status (+ a checkId only
   * when a published check exists). Served by the partial index
   * `submissions_fetch_trending_idx`.
   */
  listTrending(opts: { limit: number }): Promise<TrendingItem[]>;
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

/**
 * ADR-0012 §3: a stored entitlement row, as the service layer sees it
 * (dates as `Date`, not ISO strings — the HTTP projection in
 * lib/entitlement.ts does the ISO conversion). Mirrors the `entitlements`
 * table in packages/db/src/schema.ts.
 */
export interface EntitlementRecord {
  id: string;
  deviceTokenHash: string | null;
  userId: string | null;
  tier: EntitlementTier;
  status: EntitlementStatus;
  provider: BillingProvider;
  providerRef: string | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ADR-0012 §3 (server-authoritative entitlement). Reads the entitlement
 * for a reader (device-identified today) and applies verified billing
 * webhooks. The ad-free / premium DECISION is NOT here — it is the pure
 * `projectEntitlement` in lib/entitlement.ts, so it is unit-testable
 * without a database. This interface only persists and fetches.
 */
export interface EntitlementRepository {
  /**
   * The most recent entitlement row for a device token hash (newest by
   * `createdAt`), or null when the reader has never had one. "Latest, not
   * active" deliberately: an expired/canceled row still drives the
   * display ("expired on …"), and `projectEntitlement` decides access.
   */
  getLatestForDevice(deviceTokenHash: string): Promise<EntitlementRecord | null>;
  /**
   * Records a verified webhook idempotently on `(provider, eventId)`.
   * `firstTime=false` means this exact event was already processed (a PSP
   * retry) — the caller acks WITHOUT re-granting, the same inbox pattern
   * as `processed_messages`.
   */
  recordBillingEvent(input: {
    provider: BillingProvider;
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ firstTime: boolean }>;
  /**
   * Upserts an ACTIVE entitlement for a device subject, keyed on
   * `(provider, providerRef)` so a webhook replay updates the one row
   * rather than duplicating it. Used by the webhook handler once an event
   * is verified, deduped, and carries a subject.
   */
  activateDeviceEntitlement(input: {
    deviceTokenHash: string;
    tier: EntitlementTier;
    provider: BillingProvider;
    providerRef: string | null;
    currentPeriodEnd: Date | null;
  }): Promise<RepoResult<EntitlementRecord>>;
  /**
   * ADR-0012 §3 (monetization v2): the expiry sweeper's write. Marks every
   * `active` row whose paid period has lapsed (`current_period_end` present
   * AND strictly before `now`) as `expired` — the terminal label — and
   * returns how many rows it transitioned. A NULL `current_period_end` is a
   * never-expiring manual comp and is NEVER swept; a `canceled` row is
   * already denied lazily by `isActiveNow` once its period passes, so it is
   * left to its own display label rather than relabelled here.
   *
   * This exists so access is not ONLY lazy-evaluated at read time: without
   * it, a lapsed `active` row keeps its stale `active` status in the DB
   * forever (correctly denied by `isActiveNow`, but misleading to any
   * admin/analytics query reading `status` directly). Idempotent — a second
   * run after the first finds nothing left to transition and returns 0.
   */
  sweepExpired(now?: Date): Promise<{ expired: number }>;
  /**
   * ADR-0012 §3 (monetization v2): record the device subject that started a
   * checkout, keyed on `(provider, reference)`, so a later webhook/callback
   * that doesn't itself carry the subject (M-Pesa's Daraja STK callback only
   * echoes its `CheckoutRequestID`) can still reconcile the payment to the
   * right device. Upserts, so a re-push of the same reference refreshes it.
   * Written by the checkout route on EVERY provider's successful checkout —
   * redundant-but-harmless for Paystack/Stripe (which also echo the subject
   * in metadata), essential for M-Pesa.
   */
  putPendingSubject(input: { provider: BillingProvider; reference: string; deviceTokenHash: string }): Promise<void>;
  /**
   * Looks up the device subject recorded by `putPendingSubject`, or null if
   * none (expired/never-recorded) — in which case the webhook grant is a
   * safe no-op, exactly like a subjectless Paystack event.
   */
  getPendingSubject(input: { provider: BillingProvider; reference: string }): Promise<string | null>;
  /**
   * Housekeeping for the pending-subject map: deletes rows older than
   * `olderThan`. Rides the monetization sweeper (lib/entitlement-sweep.ts)
   * so stale mappings (abandoned/expired STK prompts) don't accumulate.
   */
  prunePendingCheckouts(olderThan: Date): Promise<{ pruned: number }>;
}
