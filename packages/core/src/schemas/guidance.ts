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
 * ADR-0038: the editorial lifecycle of a check — orthogonal to the ADR-0017
 * processing machine (`submissions.status`) and to the `isDraft`/`publishedAt`
 * publish gate (which stays authoritative). This is the autonomy-first track
 * that drives every claim to a terminal state without a human editor in the
 * common path:
 *  - `verifying`         — mirrors submission.status < ready.
 *  - `preliminary`       — an AI-grounded, NON-authoritative thread-starter
 *                          (ADR-0036 rescue); public, caveated, rating withheld
 *                          for named persons. NOT a verdict.
 *  - `awaiting_sources`  — open thread, no citable conclusion yet ("submit the truth").
 *  - `editor_review`     — the bounded human-escalation queue (NOT "every draft").
 *  - `published`         — terminal; the authoritative verdict (isDraft=false).
 *  - `dismissed`         — terminal; not checkable / dedup / rejected.
 *  - `archived_expired`  — terminal; aged out by the expiry sweep.
 * Stored nullable + backfilled by derivation, so the column is reversible
 * (drop → fall back to today's boolean behaviour). Terminal: published,
 * dismissed, archived_expired.
 */
export const CheckLifecycleSchema = z.enum([
  "verifying",
  "preliminary",
  "awaiting_sources",
  "editor_review",
  "published",
  "dismissed",
  "archived_expired",
]);
export type CheckLifecycle = z.infer<typeof CheckLifecycleSchema>;

/** Terminal lifecycle states — no outbound transition except reopen-by-source. */
export const TERMINAL_CHECK_LIFECYCLES: readonly CheckLifecycle[] = [
  "published",
  "dismissed",
  "archived_expired",
];

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

/**
 * ADR-0031 amendment (two-engine pivot) / AT-0031-7/8: Tier C's
 * configurable spectrum of handling modes.
 *  - "a" (open-question + async audit): the DEFAULT. Auto-publishes as a
 *    claim-attributed open question, never a declarative person-directed
 *    statement; always carries confidence + sources + the standing
 *    caveat; queued for async audit.
 *  - "b" (fast-track human tap): a pre-publish human confirm, STRICTER
 *    than (a) -- selecting it is never a "relaxation".
 *  - "c" (plain caveat): the Tier-A/B floor applied to Tier C. This IS a
 *    relaxation below mode (a)'s protection.
 *
 * Mirrored in app/stages/publish_policy.py's `TierCMode` (same three
 * values, same ordering semantics) -- the pipeline service does not
 * share a runtime with this package, so it is a deliberate, documented
 * mirror rather than a shared import.
 */
export const TierCModeSchema = z.enum(["a", "b", "c"]);
export type TierCMode = z.infer<typeof TierCModeSchema>;

/**
 * Higher = more protective of the named person. Mirrors
 * app/stages/publish_policy.py's `TIER_C_MODE_PROTECTION_RANK` exactly.
 */
export const TIER_C_MODE_PROTECTION_RANK: Record<TierCMode, number> = {
  b: 2,
  a: 1,
  c: 0,
};

/**
 * AT-0031-8: true exactly for a mode LESS protective than the mode-(a)
 * default (i.e. only "c" today). A config write that would set
 * `tier_c_mode` to such a value MUST go through services/api/src/lib/
 * policy-audit.ts's `updatePolicyFlag` with `relaxesTierC: true`, which
 * refuses the write without an `advocateSignoffRef` (ADR-0031 hard
 * constraint 2).
 */
export function tierCModeRelaxesBelowDefault(mode: TierCMode): boolean {
  return TIER_C_MODE_PROTECTION_RANK[mode] < TIER_C_MODE_PROTECTION_RANK.a;
}
