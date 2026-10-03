import { describe, it, expect } from "vitest";
import { SubmissionInputSchema } from "../schemas/submission.js";

describe("SubmissionInputSchema", () => {
  it("accepts a submission with only a url", () => {
    const result = SubmissionInputSchema.parse({ url: "https://example.com/video" });
    expect(result.url).toBe("https://example.com/video");
    expect(result.text).toBeUndefined();
  });

  it("rejects a submission with neither url nor text", () => {
    const result = SubmissionInputSchema.safeParse({ submittedBy: "jane" });
    expect(result.success).toBe(false);
  });

  it("rejects a submission with both url and text", () => {
    const result = SubmissionInputSchema.safeParse({
      url: "https://example.com",
      text: "some claim",
    });
    expect(result.success).toBe(false);
  });
});
