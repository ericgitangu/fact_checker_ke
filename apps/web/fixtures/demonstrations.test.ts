import { describe, it, expect } from "vitest";
import { DemonstrationSchema } from "@fact-checker-ke/core";
import { demonstrations } from "./demonstrations";

describe("demonstrations fixture", () => {
  it("every entry validates against DemonstrationSchema", () => {
    for (const demo of demonstrations) {
      expect(DemonstrationSchema.safeParse(demo).success).toBe(true);
    }
  });

  it("no entry contains coordinate-like fields", () => {
    for (const demo of demonstrations) {
      expect(Object.keys(demo)).not.toContain("lat");
      expect(Object.keys(demo)).not.toContain("lng");
    }
  });
});
