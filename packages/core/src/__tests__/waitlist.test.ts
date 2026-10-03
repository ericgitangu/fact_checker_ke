import { describe, expect, it } from "vitest";
import { WaitlistSignupInputSchema } from "../schemas/waitlist.js";

describe("WaitlistSignupInputSchema", () => {
  it("normalises email and defaults source", () => {
    const r = WaitlistSignupInputSchema.parse({ email: "  Jane@Example.COM " });
    expect(r).toEqual({ email: "jane@example.com", source: "site" });
  });
  it("rejects an invalid email", () => {
    expect(WaitlistSignupInputSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });
});
