import { describe, it, expect } from "vitest";
import { DemonstrationSchema } from "../schemas/demonstration.js";

const validDemo = {
  id: "33333333-3333-3333-3333-333333333333",
  title: "Planned march along Moi Avenue",
  area: "Nairobi Central Ward",
  county: "Nairobi",
  status: "announced" as const,
  date: "2026-10-10",
  summary: "Organisers announced a march; county has not confirmed a route.",
  sourceUrl: "https://example.com/announcement",
  updatedAt: "2026-10-03T00:00:00.000Z",
};

describe("DemonstrationSchema", () => {
  it("accepts a well-formed advisory with a ward-level area", () => {
    expect(DemonstrationSchema.safeParse(validDemo).success).toBe(true);
  });

  it("rejects an invalid status enum value", () => {
    const result = DemonstrationSchema.safeParse({ ...validDemo, status: "maybe" });
    expect(result.success).toBe(false);
  });
});
