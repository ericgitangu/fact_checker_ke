import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { updatePolicyFlag } from "../lib/policy-audit.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0031-5: Any change to a tier threshold is audit-logged and requires
 * an explicit policy flag; Tier-C relaxation additionally records an
 * advocate-signoff reference.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0031 threshold-change audit (AT-0031-5, integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actorId: string;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `admin-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    actorId = user!.id;
  });

  afterAll(async () => {
    await close();
  });

  it("an ordinary threshold change is persisted and audit-logged as policy.threshold_changed", async () => {
    const key = `tau_a_${randomUUID()}`;
    const result = await updatePolicyFlag(db, { actorId, key, value: 0.9 });
    expect(result.ok).toBe(true);

    const [flagRow] = await db.select().from(schema.policyFlags).where(eq(schema.policyFlags.key, key));
    expect(flagRow).toBeDefined();
    expect(flagRow!.value).toBe(0.9);
    expect(flagRow!.advocateSignoffRef).toBeNull();

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetType, "policy_flag"), eq(schema.auditLog.targetId, key)));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe("policy.threshold_changed");
  });

  it("Tier-C relaxation is REJECTED without an advocate-signoff reference (no rows written)", async () => {
    const key = `tier_c_relaxation_enabled_${randomUUID()}`;
    const result = await updatePolicyFlag(db, { actorId, key, value: true, relaxesTierC: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("advocate_signoff_required");

    const flagRows = await db.select().from(schema.policyFlags).where(eq(schema.policyFlags.key, key));
    expect(flagRows).toHaveLength(0);
    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetType, "policy_flag"), eq(schema.auditLog.targetId, key)));
    expect(auditRows).toHaveLength(0);
  });

  it("Tier-C relaxation WITH an advocate-signoff reference is persisted and audit-logged as policy.tier_c_relaxed", async () => {
    const key = `tier_c_relaxation_enabled_${randomUUID()}`;
    const signoffRef = `advocate-signoff-${randomUUID()}`;
    const result = await updatePolicyFlag(db, {
      actorId,
      key,
      value: true,
      advocateSignoffRef: signoffRef,
      relaxesTierC: true,
    });
    expect(result.ok).toBe(true);

    const [flagRow] = await db.select().from(schema.policyFlags).where(eq(schema.policyFlags.key, key));
    expect(flagRow!.advocateSignoffRef).toBe(signoffRef);

    const [auditRow] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.targetType, "policy_flag"), eq(schema.auditLog.targetId, key)));
    expect(auditRow!.action).toBe("policy.tier_c_relaxed");
    const metadata = auditRow!.metadata as { advocateSignoffRef: string };
    expect(metadata.advocateSignoffRef).toBe(signoffRef);
  });
});
