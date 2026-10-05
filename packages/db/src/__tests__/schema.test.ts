import { describe, expect, it } from "vitest";
import {
  AttributionSchema,
  BillingProviderSchema,
  ClaimTypeSchema,
  CommentStatusSchema,
  CredibilityTierSchema,
  DemonstrationStatusSchema,
  EntitlementStatusSchema,
  EntitlementTierSchema,
  RatingSchema,
  ReviewActionTypeSchema,
  RightOfReplyStatusSchema,
  RoleSchema,
  SubmissionStatusSchema,
  WaitlistSourceSchema,
} from "@fact-checker-ke/core";
import {
  attributionEnum,
  auditLog,
  billingProviderEnum,
  claimTypeEnum,
  claims,
  commentStatusEnum,
  credibilityTierEnum,
  demonstrationStatusEnum,
  entitlementStatusEnum,
  entitlementTierEnum,
  organizations,
  ratingEnum,
  retentionPolicy,
  reviewActionTypeEnum,
  rightOfReplyStatusEnum,
  roleEnum,
  sessions,
  submissionStatusEnum,
  totpSecrets,
  users,
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
    [roleEnum, RoleSchema],
    [attributionEnum, AttributionSchema],
    [reviewActionTypeEnum, ReviewActionTypeSchema],
    [rightOfReplyStatusEnum, RightOfReplyStatusSchema],
    [commentStatusEnum, CommentStatusSchema],
    [entitlementTierEnum, EntitlementTierSchema],
    [entitlementStatusEnum, EntitlementStatusSchema],
    [billingProviderEnum, BillingProviderSchema],
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

  it("users table has role/mfaEnabled columns (ADR-0020 §4)", () => {
    expect(Object.keys(users)).toEqual(expect.arrayContaining(["id", "email", "passwordHash", "role", "mfaEnabled"]));
  });

  it("totp_secrets is keyed 1:1 on userId", () => {
    expect(totpSecrets.userId.primary).toBe(true);
  });

  it("sessions has a hashed token primary key, never the raw token", () => {
    expect(sessions.tokenHash.primary).toBe(true);
  });

  it("audit_log has actor/action/target/metadata columns (ADR-0020 §5)", () => {
    expect(Object.keys(auditLog)).toEqual(
      expect.arrayContaining(["id", "actorId", "action", "targetType", "targetId", "metadata", "createdAt"]),
    );
  });

  it("retention_policy is keyed on dataClass (ADR-0021)", () => {
    expect(retentionPolicy.dataClass.primary).toBe(true);
  });
});
