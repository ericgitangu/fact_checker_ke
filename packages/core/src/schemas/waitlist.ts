import { z } from "zod";

/**
 * Waitlist signup contract (POST /v1/waitlist).
 * Responses: 201 {status:"joined"} | 200 {status:"already_joined"} (idempotent on
 * normalised email) | 400 validation error | 429 rate limited.
 */
export const WaitlistSourceSchema = z.enum(["site", "web"]);
export type WaitlistSource = z.infer<typeof WaitlistSourceSchema>;

/**
 * ADR-0012 monetization-signal capture (pre-launch, additive): an OPTIONAL
 * willingness-to-pay / sponsorship-interest hint collected alongside the
 * waitlist email. Never required, never blocks a signup, and carries no
 * payment data — this is a signal field, not a checkout. `interest` is
 * intentionally narrower than a free-text field so it stays one low-friction
 * select on the client (apps/web/components/waitlist-form.tsx) rather than
 * growing the form.
 */
export const WaitlistInterestSchema = z.enum(["premium", "sponsor", "free"]);
export type WaitlistInterest = z.infer<typeof WaitlistInterestSchema>;

export const WaitlistSignupInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254),
  source: WaitlistSourceSchema.default("site"),
  referrer: z.string().max(500).optional(),
  // Additive + optional: existing callers/payloads that omit this field
  // still validate unchanged.
  interest: WaitlistInterestSchema.optional(),
});
export type WaitlistSignupInput = z.infer<typeof WaitlistSignupInputSchema>;

export const WaitlistSignupResultSchema = z.object({
  status: z.enum(["joined", "already_joined"]),
});
export type WaitlistSignupResult = z.infer<typeof WaitlistSignupResultSchema>;
