import { describe, expect, it } from "vitest";
import {
  ClaimTypeSchema,
  CredibilityTierSchema,
  DemonstrationStatusSchema,
  RatingSchema,
  SubmissionStatusSchema,
  WaitlistSourceSchema,
} from "@fact-checker-ke/core";
import {
  claimTypeEnum,
  claims,
  credibilityTierEnum,
  demonstrationStatusEnum,
  organizations,
  ratingEnum,
  submissionStatusEnum,
  waitlistSignups,
  waitlistSourceEnum,
} from "../schema.js";

/**
 * Asserts the pgEnum value lists stay sourced from (and in sync with) the
 * zod enums in @fact-checker-ke/core — the whole point of building them
 * via `.options` rather than hand-duplicating the string lists (ADR-0009
 * decision: enum values have one source of truth).
 */
describe("pgEnums are sourced from @fact-checker-ke/core zod enums", () => {
  it.each([
    [submissionStatusEnum, SubmissionStatusSchema],
    [ratingEnum, RatingSchema],
    [claimTypeEnum, ClaimTypeSchema],
    [credibilityTierEnum, CredibilityTierSchema],
    [demonstrationStatusEnum, DemonstrationStatusSchema],
    [waitlistSourceEnum, WaitlistSourceSchema],
    // `as [pgEnum, zodEnum][]` would need a shared generic across six
    // distinct enum pairs; test-only helper data, not a boundary type.
  ] as [{ enumValues: string[] }, { options: readonly string[] }][])("%#", (pgEnumValue, zodSchema) => {
    expect(pgEnumValue.enumValues).toEqual(zodSchema.options);
  });
});

describe("table shape sanity", () => {
  it("organizations has id/name/created_at columns", () => {
    expect(Object.keys(organizations)).toEqual(
      expect.arrayContaining(["id", "name", "createdAt"]),
    );
  });

  it("claims.embedding is a vector(384) custom column", () => {
    expect(claims.embedding.getSQLType()).toBe("vector(384)");
  });

  it("waitlist_signups has a unique index target on email (schema-level)", () => {
    expect(waitlistSignups.email.name).toBe("email");
  });
});
