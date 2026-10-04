import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { updatePolicyFlag, type PolicyAuditResult } from "./policy-audit.js";

/**
 * ADR-0032 (two-engine pivot) / AT-0032-6: the fetch-engine kill switch —
 * `FETCH_ENGINE_ENABLED=false` (or this flipped flag) halts autonomous
 * INGESTION and autonomous PUBLISHING of fetched items within one
 * propagation cycle, while the submission engine and all read paths stay
 * live. Same audited `policy_flags` pattern as
 * services/api/src/lib/publish-kill-switch.ts (AT-0031-10) and ADR-0007's
 * `maandamano_kill_switch` — read fresh on every call, no caching layer,
 * so a flip takes effect on the very next read.
 *
 * Two independent surfaces consult this flag:
 *   1. services/pipeline's `POST /hops/fetch` (ingestion) — reads the
 *      `FETCH_ENGINE_ENABLED` env var today (see app/main.py); the env
 *      var and this DB-backed flag are deliberately BOTH consulted
 *      (either one being "disabled" halts ingestion) so an operator can
 *      flip either the env var (requires a redeploy/restart) or this
 *      flag (instant, no redeploy) — see docs/runbooks note TODO below.
 *   2. services/api's publish-enactment path (autonomous publishing of a
 *      fetch-sourced draft) — reads ONLY this DB-backed flag, since the
 *      API process has no access to the pipeline's env var at all.
 *
 * Defaults to NOT frozen (autonomous fetch ingestion/publishing is live)
 * when no row exists — matching the pipeline's own `FETCH_ENGINE_ENABLED`
 * default of "true".
 */
export const FETCH_ENGINE_KILL_SWITCH_KEY = "fetch_engine_kill_switch";

export async function isFetchEngineFrozen(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.policyFlags.value })
    .from(schema.policyFlags)
    .where(eq(schema.policyFlags.key, FETCH_ENGINE_KILL_SWITCH_KEY));
  return row?.value === true;
}

export async function setFetchEngineKillSwitch(
  db: Database,
  args: { actorId: string; enabled: boolean },
): Promise<PolicyAuditResult<{ key: string; frozen: boolean }>> {
  // `enabled: true` means "kill switch ON" i.e. the fetch engine is
  // FROZEN — mirrors publish-kill-switch.ts's naming.
  const result = await updatePolicyFlag(db, {
    actorId: args.actorId,
    key: FETCH_ENGINE_KILL_SWITCH_KEY,
    value: args.enabled,
    auditAction: "policy.kill_switch_flipped",
  });
  if (!result.ok) return result;
  return { ok: true, value: { key: FETCH_ENGINE_KILL_SWITCH_KEY, frozen: args.enabled } };
}
