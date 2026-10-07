import type { SubmissionStatus, TrendingStatus } from "@fact-checker-ke/core";

/**
 * A thin pointer to a discovered item's OWN check (the single latest check
 * whose `submission_id` is this submission), just the fields the status
 * derivation needs. Null when the discovery has produced no check of its own.
 */
export interface TrendingCheckPointer {
  checkId: string;
  isDraft: boolean;
  publishedAt: string | null;
}

/**
 * Derive the PUBLIC status of a fetch-discovered trending item from its
 * submission status and its own check (if any). This is the one place the
 * mapping lives, as a pure function, so it is unit-testable in isolation and
 * the Postgres repository applies it per row.
 *
 * Precedence (strongest signal first):
 *  1. A published check  -> `published` (+ its checkId). Strongest signal:
 *     the assessment is public, so link it regardless of the submission's
 *     status column.
 *  2. submission `failed` -> `dismissed`. A terminally-closed submission is
 *     a terminal, honest public signal — this OUTRANKS a lingering held
 *     draft on purpose: the editor-Dismiss / auto-expiry path closes a
 *     gated item by driving its submission to `failed` WITHOUT deleting the
 *     (now-abandoned) draft row (see lib/editorial.ts#applyCheckDismissal),
 *     and such an item must read as `dismissed`, never a perpetual
 *     `under_review`. In normal pipeline flow a `failed` submission never
 *     has a check at all (the draft is only created on the successful
 *     verify path), so this reordering is a no-op for every
 *     non-dismissed row.
 *  3. A held DRAFT check -> `under_review`. We expose NO checkId and NO
 *     rating — a draft's verdict is not public; "under review" is a
 *     tracking state, not a verdict, and NOT a promise that a human is
 *     actively assessing it (there may be no editor): a verdict is
 *     published only once the item clears review.
 *  4. Everything else (received/analyzing/analyzed/verifying, and `ready`
 *     with no check of its own — e.g. deduped to an already-published claim
 *     owned by a different submission, or no checkable claim) ->
 *     `monitoring`. We do NOT fabricate a `published` from another
 *     submission's check.
 */
export function deriveTrendingStatus(
  submissionStatus: SubmissionStatus,
  check: TrendingCheckPointer | null,
): { status: TrendingStatus; checkId: string | null } {
  if (check && !check.isDraft && check.publishedAt) {
    return { status: "published", checkId: check.checkId };
  }
  if (submissionStatus === "failed") {
    return { status: "dismissed", checkId: null };
  }
  if (check && check.isDraft) {
    return { status: "under_review", checkId: null };
  }
  return { status: "monitoring", checkId: null };
}
