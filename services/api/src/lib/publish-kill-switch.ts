import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { updatePolicyFlag, type PolicyAuditResult } from "./policy-audit.js";

/**
 * ADR-0031 amendment (two-engine pivot) / AT-0031-10: the autonomous-
 * publish kill switch. Same pattern as ADR-0007's
 * `maandamano_kill_switch` (services/api/src/lib/maandamano.ts) — an
 * ordinary audited `policy_flags` row, read fresh on every call (no
 * caching layer here), so a flip takes effect on the very next read.
 * Defaults to NOT frozen: a missing row means autonomous publishing is
 * live, matching `PublishPolicyFlags.global_auto_publish_enabled`'s new
 * `True` default in app/stages/publish_policy.py.
 */
export const AUTONOMOUS_PUBLISH_KILL_SWITCH_KEY = "autonomous_publish_kill_switch";

export async function isAutonomousPublishFrozen(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.policyFlags.value })
    .from(schema.policyFlags)
    .where(eq(schema.policyFlags.key, AUTONOMOUS_PUBLISH_KILL_SWITCH_KEY));
  return row?.value === true;
}

/**
 * The audited flip. Goes through `updatePolicyFlag` so the flip lands in
 * the SAME transaction as an `audit_log` row
 * (`action: 'policy.kill_switch_flipped'`) — AT-0031-10's "within one
 * propagation cycle" means exactly this: the next caller to read
 * `isAutonomousPublishFrozen` (or the pipeline's equivalent read of this
 * same flag, mapped onto `PublishPolicyFlags.global_auto_publish_enabled`)
 * sees the new value, because there is nothing in between caching the
 * old one. Read paths (fetching/viewing already-published checks) never
 * consult this flag at all — only the publish decision does — so
 * flipping it never affects read availability.
 */
export async function setAutonomousPublishKillSwitch(
  db: Database,
  args: { actorId: string; enabled: boolean },
): Promise<PolicyAuditResult<{ key: string; frozen: boolean }>> {
  // `enabled: true` means "kill switch ON" i.e. autonomous publishing is
  // FROZEN — mirrors maandamano's `enabled` naming (true = switch thrown).
  const result = await updatePolicyFlag(db, {
    actorId: args.actorId,
    key: AUTONOMOUS_PUBLISH_KILL_SWITCH_KEY,
    value: args.enabled,
    auditAction: "policy.kill_switch_flipped",
  });
  if (!result.ok) return result;
  return { ok: true, value: { key: AUTONOMOUS_PUBLISH_KILL_SWITCH_KEY, frozen: args.enabled } };
}
