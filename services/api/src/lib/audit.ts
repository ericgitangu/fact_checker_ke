import { schema, type Database } from "@fact-checker-ke/db";
import type { AuditAction } from "@fact-checker-ke/core";

/**
 * ADR-0020 §5: writes ONE audit_log row in the SAME transaction as the
 * action it records (reuses the ADR-0017 outbox pattern's "same tx"
 * discipline). Callers always pass the transaction-scoped `tx` from
 * inside `db.transaction(async (tx) => ...)` — a rolled-back action
 * rolls this row back too, which is exactly AT-0020-4's "a rolled-back
 * action produces zero rows" requirement.
 *
 * No `updateAuditLog`/`deleteAuditLog` exists anywhere in this codebase
 * — that omission IS the immutability enforcement (see the schema.ts
 * docblock on `auditLog` for why a DB-role-level REVOKE isn't available
 * against Neon's single owner role here).
 */
export async function writeAuditLog(
  tx: Database,
  entry: {
    actorId: string | null;
    action: AuditAction;
    targetType: string;
    targetId: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
  });
}
