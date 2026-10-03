import { describe, it, expect } from "vitest";
import { buildClaimReviewJsonLd, ClaimReviewValidationError } from "../claim-review/builder.js";
import type { Check } from "../schemas/check.js";

const baseCheck: Check = {
  id: "11111111-1111-1111-1111-111111111111",
  submissionId: "22222222-2222-2222-2222-222222222222",
  summary: "Checked a claim about fuel subsidy figures.",
  rating: "False",
  claims: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      checkId: "11111111-1111-1111-1111-111111111111",
      text: "Fuel subsidies were cut to zero in 2025.",
      claimType: "checkable",
      spanStart: 0,
      spanEnd: 40,
      namedPerson: false,
      attribution: "not_applicable",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  sources: [],
  isDraft: false,
  reviewedBy: "jane@example.com",
  createdAt: "2026-10-01T00:00:00.000Z",
  publishedAt: "2026-10-02T00:00:00.000Z",
};

describe("buildClaimReviewJsonLd", () => {
  it("builds a valid ClaimReview object for a rated, published check", () => {
    const jsonLd = buildClaimReviewJsonLd(baseCheck, {
      url: "https://fact-checker.ke/checks/11111111-1111-1111-1111-111111111111",
      publisherName: "fact_checker_ke",
      publisherUrl: "https://fact-checker.ke",
    }) as Record<string, unknown>;

    expect(jsonLd["@type"]).toBe("ClaimReview");
    expect(jsonLd.claimReviewed).toBe("Fuel subsidies were cut to zero in 2025.");
    expect((jsonLd.reviewRating as Record<string, unknown>).ratingValue).toBe(1);
  });

  it("throws ClaimReviewValidationError for an unrated (draft) check", () => {
    const draft: Check = { ...baseCheck, rating: null };
    expect(() =>
      buildClaimReviewJsonLd(draft, {
        url: "https://fact-checker.ke/checks/x",
        publisherName: "fact_checker_ke",
        publisherUrl: "https://fact-checker.ke",
      }),
    ).toThrow(ClaimReviewValidationError);
  });
});
