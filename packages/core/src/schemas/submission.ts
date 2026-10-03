import { z } from "zod";

/**
 * Inbound submission from a user: either a URL to a piece of media/content,
 * or raw pasted text. Exactly one of `url` / `text` must be present —
 * enforced with a refine rather than a discriminated union so the API can
 * return one coherent validation error shape.
 */
export const SubmissionInputSchema = z
  .object({
    url: z.string().url().optional(),
    text: z.string().min(1).max(20_000).optional(),
    /**
     * ADR-0002 (accepted): for third-party video URLs we never download audio.
     * The submitter pastes the exact quote and where it occurs; we check that text.
     */
    quote: z.string().min(1).max(5_000).optional(),
    timestampSec: z.number().int().nonnegative().max(86_400).optional(),
    submittedBy: z.string().min(1).max(200).optional(),
  })
  .refine((data) => Boolean(data.url) !== Boolean(data.text), {
    message: "Provide exactly one of `url` or `text`.",
    path: ["url"],
  })
  .refine((data) => !(data.text && (data.quote || data.timestampSec !== undefined)), {
    message: "`quote`/`timestampSec` only apply to `url` submissions.",
    path: ["quote"],
  });
export type SubmissionInput = z.infer<typeof SubmissionInputSchema>;

export const SubmissionStatusSchema = z.enum([
  "received",
  "processing",
  "ready",
  "failed",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const SubmissionSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url().nullable(),
  text: z.string().nullable(),
  submittedBy: z.string().nullable(),
  status: SubmissionStatusSchema,
  createdAt: z.string().datetime(),
});
export type Submission = z.infer<typeof SubmissionSchema>;
