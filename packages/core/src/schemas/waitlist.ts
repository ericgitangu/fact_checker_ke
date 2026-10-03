import { z } from "zod";

/**
 * Waitlist signup contract (POST /v1/waitlist).
 * Responses: 201 {status:"joined"} | 200 {status:"already_joined"} (idempotent on
 * normalised email) | 400 validation error | 429 rate limited.
 */
export const WaitlistSourceSchema = z.enum(["site", "web"]);
export type WaitlistSource = z.infer<typeof WaitlistSourceSchema>;

export const WaitlistSignupInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254),
  source: WaitlistSourceSchema.default("site"),
  referrer: z.string().max(500).optional(),
});
export type WaitlistSignupInput = z.infer<typeof WaitlistSignupInputSchema>;

export const WaitlistSignupResultSchema = z.object({
  status: z.enum(["joined", "already_joined"]),
});
export type WaitlistSignupResult = z.infer<typeof WaitlistSignupResultSchema>;
