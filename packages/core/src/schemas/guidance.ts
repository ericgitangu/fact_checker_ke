import { z } from "zod";

/**
 * ADR-0031: risk tiers are the publish-policy axis.
 * `risk = f(names a living person?, severity of imputation, reach)`.
 *  - A (low): no named person — general/numeric/provenance claims.
 *  - B (medium): names a person, finding framed non-defamatorily.
 *  - C (high): a hard-negative finding that unavoidably imputes
 *    dishonesty/criminality to a named living person — ALWAYS a human
 *    confirm, regardless of model confidence (hard constraint 2).
 */
export const RiskTierSchema = z.enum(["A", "B", "C"]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

/**
 * One cited piece of evidence backing a published assessment. `sourceId`
 * refers to a `Source` already attached to the same Check; `quote` is the
 * specific span that supports (or fails to support) the claim — ADR-0031's
 * "here are the sources" half of the output model.
 */
export const EvidenceItemSchema = z.object({
  sourceId: z.string().uuid(),
  quote: z.string().min(1).max(2000),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/**
 * ADR-0031 / ADR-0023 framing rule: a published result is a claim-and-
 * evidence assessment ("the evidence we found does/doesn't support this
 * claim"), never a bare person-indicting verdict ("[Name] lied").
 *
 * This is a deliberately narrow, rule-based lexical guard — not an ML
 * classifier (no billable calls, per the task's scaffolding-only rule).
 * It is a backstop against the worst-case phrasing, not a full style
 * checker; editors remain responsible for framing quality overall.
 */
const BARE_INDICTMENT_PATTERNS: RegExp[] = [
  /\blied\b/i,
  /\bis a liar\b/i,
  /\bis corrupt\b/i,
  /\bcommitted (a |an )?(crime|fraud|bribery)\b/i,
  /\bis a criminal\b/i,
  /\bstole\b/i,
  /\bis guilty\b/i,
];

export function isBareIndictmentFraming(summary: string): boolean {
  return BARE_INDICTMENT_PATTERNS.some((pattern) => pattern.test(summary));
}

export class FramingViolationError extends Error {
  constructor(summary: string) {
    super(
      `Summary renders a bare person-indicting verdict instead of claim-and-evidence framing (ADR-0031/ADR-0023): ${JSON.stringify(summary)}`,
    );
    this.name = "FramingViolationError";
  }
}

export function assertClaimAndEvidenceFraming(summary: string): void {
  if (isBareIndictmentFraming(summary)) {
    throw new FramingViolationError(summary);
  }
}
