import type { Check } from "../schemas/check.js";
import type { Rating } from "../schemas/rating.js";

/**
 * Maps our internal Rating enum onto a 1-5 schema.org `ratingValue` plus a
 * human label, following Google's ClaimReview guidance (1 = lowest/false,
 * 5 = highest/true). "NotCheckable" has no meaningful numeric position and
 * is represented as a 0 with an explicit alternateName so renderers don't
 * silently mis-score it as "worse than false".
 */
const RATING_VALUE_MAP: Record<Rating, { ratingValue: number; alternateName: string }> = {
  True: { ratingValue: 5, alternateName: "True" },
  MostlyTrue: { ratingValue: 4, alternateName: "Mostly True" },
  Misleading: { ratingValue: 2, alternateName: "Misleading" },
  False: { ratingValue: 1, alternateName: "False" },
  Unproven: { ratingValue: 3, alternateName: "Unproven" },
  NotCheckable: { ratingValue: 0, alternateName: "Not Checkable" },
};

export interface ClaimReviewBuilderOptions {
  /** Canonical, publicly reachable URL of the /checks/[id] page. */
  url: string;
  /** Publisher identity shown in the JSON-LD `author` field. */
  publisherName: string;
  publisherUrl: string;
}

export class ClaimReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimReviewValidationError";
  }
}

/**
 * Builds a schema.org ClaimReview JSON-LD object for a published Check.
 * Throws ClaimReviewValidationError if the Check has no rating yet (drafts
 * must not be embedded as ClaimReview — see apps/web /checks/[id] page,
 * which gates this behind `check.isDraft === false`).
 */
export function buildClaimReviewJsonLd(check: Check, options: ClaimReviewBuilderOptions): object {
  if (check.rating === null) {
    throw new ClaimReviewValidationError(
      `Cannot build ClaimReview for check ${check.id}: no rating assigned yet.`,
    );
  }
  if (check.claims.length === 0) {
    throw new ClaimReviewValidationError(
      `Cannot build ClaimReview for check ${check.id}: no claims attached.`,
    );
  }

  const ratingInfo = RATING_VALUE_MAP[check.rating];
  const primaryClaim = check.claims[0];
  if (!primaryClaim) {
    throw new ClaimReviewValidationError(
      `Cannot build ClaimReview for check ${check.id}: claims array is empty.`,
    );
  }

  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    url: options.url,
    claimReviewed: primaryClaim.text,
    itemReviewed: {
      "@type": "CreativeWork",
      author: {
        "@type": "Organization",
        name: check.reviewedBy ?? "Unknown",
      },
    },
    author: {
      "@type": "Organization",
      name: options.publisherName,
      url: options.publisherUrl,
    },
    reviewRating: {
      "@type": "Rating",
      ratingValue: ratingInfo.ratingValue,
      alternateName: ratingInfo.alternateName,
      bestRating: 5,
      worstRating: 0,
    },
    datePublished: check.publishedAt ?? undefined,
  };
}
