import { describe, it, expect } from "vitest";
import { detectLanguages } from "./language-detect";

describe("detectLanguages (heuristic stub, not production NLP)", () => {
  it("defaults to English for empty input", () => {
    expect(detectLanguages("")).toEqual(["en"]);
  });

  it("detects English-only text as English", () => {
    expect(detectLanguages("Unemployment fell to two percent last year")).toEqual(["en"]);
  });

  it("detects Swahili markers", () => {
    const result = detectLanguages("Serikali ina pesa kwa watu wote sasa");
    expect(result).toContain("sw");
  });

  it("detects Sheng markers", () => {
    const result = detectLanguages("Msee huyu ni noma sana, fiti kabisa buda");
    expect(result).toContain("sheng");
  });

  it("can detect multiple languages in mixed text", () => {
    const result = detectLanguages("The msee said serikali ina pesa, bro");
    expect(result).toContain("sheng");
    expect(result).toContain("sw");
  });
});
