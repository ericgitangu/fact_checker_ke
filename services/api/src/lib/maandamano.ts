import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { Demonstration, MaandamanoResponse } from "@fact-checker-ke/core";
import { updatePolicyFlag, type PolicyAuditResult } from "./policy-audit.js";

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A). The switch is modelled as
 * an ordinary audited `policy_flags` row (reusing ADR-0031's
 * `updatePolicyFlag`, see docs/runbooks/nc4-kill-switch.md Step 2.1) —
 * no new table/migration. Defaults OFF: a missing row (nothing has ever
 * flipped it) means `isMaandamanoFrozen` returns `false`.
 */
export const MAANDAMANO_KILL_SWITCH_KEY = "maandamano_kill_switch";

export async function isMaandamanoFrozen(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.policyFlags.value })
    .from(schema.policyFlags)
    .where(eq(schema.policyFlags.key, MAANDAMANO_KILL_SWITCH_KEY));
  return row?.value === true;
}

/**
 * The audited flip (runbook Step 2.1). Goes through `updatePolicyFlag`
 * so the flip is written in the SAME transaction as an `audit_log` row
 * (`action: 'policy.kill_switch_flipped'`, `target_id:
 * 'maandamano_kill_switch'`, `metadata.value` the new boolean) — see
 * services/api/src/lib/policy-audit.ts. This function does NOT trigger
 * ISR revalidation itself (that's the route handler's job, see
 * routes/maandamano.ts) so this stays testable against a bare DB
 * without a running web app.
 */
export async function setMaandamanoKillSwitch(
  db: Database,
  args: { actorId: string; enabled: boolean },
): Promise<PolicyAuditResult<{ key: string; enabled: boolean }>> {
  const result = await updatePolicyFlag(db, {
    actorId: args.actorId,
    key: MAANDAMANO_KILL_SWITCH_KEY,
    value: args.enabled,
    auditAction: "policy.kill_switch_flipped",
  });
  if (!result.ok) return result;
  return { ok: true, value: { key: MAANDAMANO_KILL_SWITCH_KEY, enabled: args.enabled } };
}

function toDemonstration(row: typeof schema.demonstrations.$inferSelect): Demonstration {
  return {
    id: row.id,
    title: row.title,
    area: row.area,
    county: row.county,
    status: row.status,
    date: row.date,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * ADR-0007 AT-0007-A server-side enforcement: the ONE function that
 * decides what a reader (public `GET /v1/maandamano`, and apps/web's
 * server-side render of `/maandamano` through it) gets to see. While
 * frozen, this NEVER queries/returns `schema.demonstrations` rows —
 * `demonstrations` is hardcoded `[]`, not merely omitted from a
 * client-side render. There is no code path in this module, or in
 * routes/maandamano.ts, that reaches the demonstrations table while
 * `frozen` is true; a reader cannot retrieve the live list by calling
 * the API directly, only by an operator flipping the switch back.
 */
export async function getMaandamanoAdvisories(db: Database): Promise<MaandamanoResponse> {
  const frozen = await isMaandamanoFrozen(db);
  if (frozen) {
    return { frozen: true, demonstrations: [] };
  }
  const rows = await db.select().from(schema.demonstrations).orderBy(schema.demonstrations.updatedAt);
  return { frozen: false, demonstrations: rows.map(toDemonstration) };
}
