import type { CheckLifecycle, SubmissionStatus, TrendingStatus } from "@fact-checker-ke/core";

/**
 * A thin pointer to a discovered item's OWN check (the single latest check
 * whose `submission_id` is this submission), just the fields the status
 * derivation needs. Null when the discovery has produced no check of its own.
 *
 * ADR-0038: `lifecycleState` is the orthogonal editorial track (nullable for
 * legacy rows backfilled pre-0038, or a check created before the flag was on).
 * The derivation now keys off it so the public status tells the honest truth
 * (held ≠ "a human is assessing it") — see below.
 */
export interface TrendingCheckPointer {
  checkId: string;
  isDraft: boolean;
  publishedAt: string | null;
  /** ADR-0038 editorial lifecycle. Optional so pre-0038 pointer literals
   * (tests, in-memory seeds) keep compiling; treated as `null` (legacy). */
  lifecycleState?: CheckLifecycle | null;
}

/**
 * Derive the PUBLIC status of a fetch-discovered trending item from its
 * submission status and its own check (if any). This is the one place the
 * mapping lives, as a pure function, so it is unit-testable in isolation and
 * the Postgres repository applies it per row.
 *
 * ADR-0038 honest-copy correction (replaces the old "any held DRAFT →
 * under_review" rule, which lied that a human editor was assessing every held
 * item). `under_review` is now emitted **only** when the check's
 * `lifecycle_state === 'editor_review'` — the bounded escalation queue — and
 * the autonomy-first non-terminal states (`preliminary`/`awaiting_sources`)
 * read as `monitoring`, which is the honest "the pipeline is still working on
 * it, no human is required" signal. `TrendingStatus` (packages/core) has no
 * `preliminary`/`awaiting_sources` value and this wave does not add one, so
 * those map onto the existing `monitoring`; the per-card next-step affordance
 * (apps/web) carries the finer-grained lifecycle itself.
 *
 * Precedence (strongest signal first):
 *  1. A published check (or `lifecycle_state === 'published'`) → `published`
 *     (+ its checkId). Strongest signal: the assessment is public, so link it
 *     regardless of the submission's status column.
 *  2. A terminally-closed editorial state (`dismissed`/`archived_expired`) OR a
 *     `failed` submission → `dismissed`. A terminal, honest public signal; a
 *     `failed` submission in normal flow never has a check at all, so this
 *     reordering is a no-op for every non-dismissed row.
 *  3. `lifecycle_state === 'editor_review'` → `under_review` — and ONLY this.
 *     We expose NO checkId and NO rating (a held verdict is not public).
 *  4. Everything else — `preliminary`/`awaiting_sources`, a legacy held draft
 *     with no lifecycle, or an in-flight/deduped submission → `monitoring`. We
 *     do NOT fabricate a `published` from another submission's check, and we
 *     never claim a human is assessing a merely-autonomous item.
 */
export function deriveTrendingStatus(
  submissionStatus: SubmissionStatus,
  check: TrendingCheckPointer | null,
): { status: TrendingStatus; checkId: string | null } {
  const lifecycle = check?.lifecycleState ?? null;

  if (check && ((!check.isDraft && check.publishedAt) || lifecycle === "published")) {
    return { status: "published", checkId: check.checkId };
  }
  if (lifecycle === "dismissed" || lifecycle === "archived_expired") {
    return { status: "dismissed", checkId: null };
  }
  if (submissionStatus === "failed") {
    return { status: "dismissed", checkId: null };
  }
  if (lifecycle === "editor_review") {
    return { status: "under_review", checkId: null };
  }
  return { status: "monitoring", checkId: null };
}
