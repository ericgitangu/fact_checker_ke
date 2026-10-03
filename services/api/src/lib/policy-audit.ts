import { schema, type Database } from "@fact-checker-ke/db";
import { writeAuditLog } from "./audit.js";

export type PolicyAuditResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

/**
 * ADR-0031 hard constraint 2 / AT-0031-5: any change to a tier threshold
 * (or any other publish-policy flag) is audit-logged and requires an
 * explicit policy flag write — there is no implicit/default-param path
 * that changes a threshold without this function. Relaxing Tier C
 * (`key: "tier_c_relaxation_enabled"`) additionally REQUIRES an
 * `advocateSignoffRef` — rejected (not silently dropped) when missing,
 * because ADR-0031 calls that relaxation "irreversible-in-consequence":
 * it must never happen without a recorded human sign-off.
 *
 * Writes `policy_flags` + `audit_log` in the SAME transaction (same
 * discipline as every other audited mutation in this codebase — see
 * lib/editorial.ts) so a rolled-back write produces zero rows in either
 * table.
 */
export async function updatePolicyFlag(
  db: Database,
  args: {
    actorId: string;
    key: string;
    value: unknown;
    advocateSignoffRef?: string | null;
    /**
     * Set true when this write relaxes the Tier-C human gate. Callers
     * decide this explicitly (not inferred from `key`'s string contents)
     * so a differently-named or namespaced key can't accidentally bypass
     * the advocate-signoff requirement, and so a key that merely
     * MENTIONS "tier_c" without actually relaxing it isn't over-gated.
     */
    relaxesTierC?: boolean;
  },
): Promise<PolicyAuditResult<{ key: string }>> {
  const isTierCRelaxation = args.relaxesTierC === true;
  if (isTierCRelaxation && !args.advocateSignoffRef) {
    return {
      ok: false,
      error: {
        kind: "advocate_signoff_required",
        message:
          "Relaxing the Tier-C human gate requires an advocate-signoff reference (ADR-0031 hard constraint 2).",
      },
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.policyFlags)
      .values({
        key: args.key,
        value: args.value,
        advocateSignoffRef: args.advocateSignoffRef ?? null,
        updatedBy: args.actorId,
      })
      .onConflictDoUpdate({
        target: schema.policyFlags.key,
        set: {
          value: args.value,
          advocateSignoffRef: args.advocateSignoffRef ?? null,
          updatedBy: args.actorId,
          updatedAt: new Date(),
        },
      });

    await writeAuditLog(tx, {
      actorId: args.actorId,
      action: isTierCRelaxation ? "policy.tier_c_relaxed" : "policy.threshold_changed",
      targetType: "policy_flag",
      targetId: args.key,
      metadata: {
        key: args.key,
        value: args.value,
        advocateSignoffRef: args.advocateSignoffRef ?? null,
      },
    });
  });

  return { ok: true, value: { key: args.key } };
}
