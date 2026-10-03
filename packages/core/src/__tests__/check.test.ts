import { describe, it, expect } from "vitest";
import { CheckSchema } from "../schemas/check.js";

const validCheck = {
  id: "11111111-1111-1111-1111-111111111111",
  submissionId: "22222222-2222-2222-2222-222222222222",
  summary: "A claim about tax rates was checked against KRA data.",
  rating: "MostlyTrue" as const,
  claims: [],
  sources: [],
  isDraft: true,
  reviewedBy: null,
  createdAt: "2026-10-03T00:00:00.000Z",
  publishedAt: null,
};

describe("CheckSchema", () => {
  it("accepts a well-formed draft check", () => {
    expect(CheckSchema.safeParse(validCheck).success).toBe(true);
  });

  it("rejects an invalid rating value", () => {
    const result = CheckSchema.safeParse({ ...validCheck, rating: "TotallyFalse" });
    expect(result.success).toBe(false);
  });
});
