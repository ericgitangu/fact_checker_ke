import { z } from "zod";
import { RatingSchema } from "./rating.js";
import { ClaimSchema } from "./claim.js";
import { SourceSchema } from "./source.js";
import { EvidenceItemSchema, RiskTierSchema, isBareIndictmentFraming } from "./guidance.js";

/**
 * A Check is the user-facing unit of work: one submission produces one or
 * more Checks (one per extracted claim group), each with a draft verdict
 * that a human reviewer must approve before `publishedAt` is set.
 *
 * ADR-0031 additions: a published Check carries the *calibrated* confidence
 * weight (not the raw LLM confidence — see services/pipeline/app/eval/
 * calibrate.py), the `what_would_change_this` falsifiability note the
 * pipeline already emits (ADR-0004 step 6), the cited `evidence[]` backing
 * the assessment, and the `riskTier` that drove the publish-policy
 * decision. These four are nullable pre-publish (a fresh draft has none of
 * them yet) but are enforced as REQUIRED, non-bare-indictment content on
 * any Check that is actually published — see the `superRefine` below,
 * which is AT-0031-1 encoded directly into the single-source-of-truth
 * contract rather than left to callers to remember.
 */
export const CheckSchema = z
  .object({
    id: z.string().uuid(),
    submissionId: z.string().uuid(),
    summary: z.string().min(1).max(4000),
    rating: RatingSchema.nullable(),
    claims: z.array(ClaimSchema),
    sources: z.array(SourceSchema),
    isDraft: z.boolean(),
    reviewedBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    /** Measured-calibrated P(correct), NOT the raw LLM confidence (ADR-0031 hard constraint 1). */
    calibratedConfidence: z.number().min(0).max(1).nullable(),
    /** ADR-0004 step 6 / ADR-0031: what evidence would change this assessment. */
    whatWouldChangeThis: z.string().min(1).max(2000).nullable(),
    /** ADR-0034: the reader-facing context that LEADS the artifact — (a) what
     * the claim asserts, (b) how it misleads, (c) the actual context + any
     * kernel of truth. Nullable at rest; required non-empty on a published
     * check (superRefine below), same gate as whatWouldChangeThis. */
    context: z.string().min(1).max(2000).nullable(),
    /** Cited evidence backing the assessment (ADR-0031's "here are the sources"). */
    evidence: z.array(EvidenceItemSchema),
    /** The risk tier that gated (or will gate) auto-publish for this Check. */
    riskTier: RiskTierSchema.nullable(),
  })
  .superRefine((check, ctx) => {
    if (check.isDraft || !check.publishedAt) return;
    // A published Check is an "assessment, not an accusation" (ADR-0031):
    // calibrated_confidence + what_would_change_this + cited evidence must
    // all be present, and the framing must never be a bare indictment.
    if (check.calibratedConfidence === null) {
      ctx.addIssue({
        code: "custom",
        path: ["calibratedConfidence"],
        message: "A published Check must carry calibrated_confidence (ADR-0031 AT-0031-1).",
      });
    }
    if (check.whatWouldChangeThis === null) {
      ctx.addIssue({
        code: "custom",
        path: ["whatWouldChangeThis"],
        message: "A published Check must carry what_would_change_this (ADR-0031 AT-0031-1).",
      });
    }
    if (check.evidence.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "A published Check must cite at least one evidence item (ADR-0031 AT-0031-1).",
      });
    }
    // ADR-0034: context is the artifact's LEAD, so it is required on publish
    // (same gate as what_would_change_this) and is policed by the same
    // bare-indictment framing ban as the summary, so it can't smuggle an
    // accusation past ADR-0023.
    if (check.context === null) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "A published Check must carry context (ADR-0034).",
      });
    }
    if (isBareIndictmentFraming(check.summary) || (check.context !== null && isBareIndictmentFraming(check.context))) {
      ctx.addIssue({
        code: "custom",
        path: ["summary"],
        message:
          "A published Check must never render a bare person-indicting verdict — use claim-and-evidence framing (ADR-0031/ADR-0023).",
      });
    }
  });
export type Check = z.infer<typeof CheckSchema>;
