import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Database } from "@fact-checker-ke/db";
import { TierCModeSchema, tierCModeRelaxesBelowDefault, type TierCMode } from "@fact-checker-ke/core";
import { updatePolicyFlag, type PolicyAuditResult } from "./policy-audit.js";

/**
 * ADR-0031 amendment (two-engine pivot) / AT-0031-8: the Tier-C handling
 * mode is CONFIGURATION, selectable per (tier, entity, topic, window),
 * audit-logged, advocate-referenced where it relaxes exposure below mode
 * (a) — not a code change. One `policy_flags` row (key below) holds the
 * whole config as jsonb: a `defaultMode` plus an ordered list of rules,
 * first-match-wins, same "config lives in policy_flags, not code"
 * pattern as every other ADR-0031/0007 policy flag in this codebase.
 */
export const TIER_C_MODE_CONFIG_KEY = "tier_c_mode_config";

export interface TierCModeRule {
  /** Omit a field to match any value for that axis. */
  entity?: string;
  topic?: string;
  window?: string;
  mode: TierCMode;
}

export interface TierCModeConfig {
  defaultMode: TierCMode;
  rules: TierCModeRule[];
}

/** AT-0031-7: the default config is mode (a) with no overrides. */
export const DEFAULT_TIER_C_MODE_CONFIG: TierCModeConfig = { defaultMode: "a", rules: [] };

export interface TierCModeSelector {
  entity?: string | null;
  topic?: string | null;
  window?: string | null;
}

function ruleMatches(rule: TierCModeRule, selector: TierCModeSelector): boolean {
  if (rule.entity !== undefined && rule.entity !== selector.entity) return false;
  if (rule.topic !== undefined && rule.topic !== selector.topic) return false;
  if (rule.window !== undefined && rule.window !== selector.window) return false;
  return true;
}

/**
 * AT-0031-8: `(tier, entity?, topic?, window?) -> mode`. `tier` is
 * accepted explicitly (and reserved) rather than omitted — today's config
 * shape only ever governs Tier C (the one tier with a configurable
 * spectrum), but keeping the parameter documents that a non-C tier
 * should never reach this selector at all; callers assert `tier === "C"`
 * before calling this, the same "accepted but not yet load-bearing"
 * pattern as `risk_tier.py`'s `reach` parameter.
 */
export function selectTierCMode(
  config: TierCModeConfig,
  tier: "C",
  selector: TierCModeSelector = {},
): TierCMode {
  void tier;
  for (const rule of config.rules) {
    if (ruleMatches(rule, selector)) return rule.mode;
  }
  return config.defaultMode;
}

/**
 * Does ANY effective selection point in this config relax Tier-C
 * protection below mode (a) — i.e. is the default mode "c", or does any
 * rule set mode "c"? Used to decide whether a config WRITE must go
 * through the advocate-signoff gate.
 */
export function configRelaxesTierCBelowDefault(config: TierCModeConfig): boolean {
  if (tierCModeRelaxesBelowDefault(config.defaultMode)) return true;
  return config.rules.some((rule) => tierCModeRelaxesBelowDefault(rule.mode));
}

export async function getTierCModeConfig(db: Database): Promise<TierCModeConfig> {
  const [row] = await db
    .select({ value: schema.policyFlags.value })
    .from(schema.policyFlags)
    .where(eq(schema.policyFlags.key, TIER_C_MODE_CONFIG_KEY));
  if (!row) return DEFAULT_TIER_C_MODE_CONFIG;
  const parsed = TierCModeConfigLikeSchema.safeParse(row.value);
  if (!parsed.success) return DEFAULT_TIER_C_MODE_CONFIG;
  return parsed.data;
}

// Minimal structural validation of the jsonb payload read back from
// Postgres — not exported, this is purely a defensive parse so a
// malformed/legacy row can't crash `getTierCModeConfig`.
const TierCModeConfigLikeSchema = z.object({
  defaultMode: TierCModeSchema,
  rules: z.array(
    z.object({
      entity: z.string().optional(),
      topic: z.string().optional(),
      window: z.string().optional(),
      mode: TierCModeSchema,
    }),
  ),
});

/**
 * AT-0031-8's write-time gate, reusing (NOT duplicating)
 * `updatePolicyFlag`'s `relaxesTierC` + `advocateSignoffRef` check: a
 * config write that would relax Tier-C protection below mode (a) is
 * rejected unless `advocateSignoffRef` is supplied — exactly the same
 * rejection path AT-0031-5 already covers for
 * `tier_c_relaxation_enabled`.
 */
export async function updateTierCModeConfig(
  db: Database,
  args: { actorId: string; config: TierCModeConfig; advocateSignoffRef?: string | null },
): Promise<PolicyAuditResult<{ config: TierCModeConfig }>> {
  const relaxes = configRelaxesTierCBelowDefault(args.config);
  const result = await updatePolicyFlag(db, {
    actorId: args.actorId,
    key: TIER_C_MODE_CONFIG_KEY,
    value: args.config,
    advocateSignoffRef: args.advocateSignoffRef ?? null,
    relaxesTierC: relaxes,
  });
  if (!result.ok) return result;
  return { ok: true, value: { config: args.config } };
}
