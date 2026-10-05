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
 *  2. A held DRAFT check -> `under_review`. A human editor is assessing it
 *     (decision C). We expose NO checkId and NO rating — a draft's verdict is
 *     not public; "under review" is a tracking state, not a verdict.
 *  3. submission `failed` -> `dismissed`.
 *  4. Everything else (received/analyzing/analyzed/verifying, and `ready` with
 *     no check of its own — e.g. deduped to an already-published claim owned
 *     by a different submission, or no checkable claim) -> `monitoring`. We do
 *     NOT fabricate a `published` from another submission's check.
 */
export function deriveTrendingStatus(
  submissionStatus: SubmissionStatus,
  check: TrendingCheckPointer | null,
): { status: TrendingStatus; checkId: string | null } {
  if (check && !check.isDraft && check.publishedAt) {
    return { status: "published", checkId: check.checkId };
  }
  if (check && check.isDraft) {
    return { status: "under_review", checkId: null };
  }
  if (submissionStatus === "failed") {
    return { status: "dismissed", checkId: null };
  }
  return { status: "monitoring", checkId: null };
}
