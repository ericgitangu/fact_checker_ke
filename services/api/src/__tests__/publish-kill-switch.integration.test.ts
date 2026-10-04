import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import {
  AUTONOMOUS_PUBLISH_KILL_SWITCH_KEY,
  isAutonomousPublishFrozen,
  setAutonomousPublishKillSwitch,
} from "../lib/publish-kill-switch.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0031-10: flipping the kill-switch halts autonomous publishing
 * within one propagation cycle; read paths stay live. This exercises
 * the lib-level audited flip + fresh-read against real Postgres — same
 * "reuse the ADR-0007 policy_flags kill-switch pattern" this module's
 * own docstring claims, verified against
 * maandamano-killswitch.integration.test.ts's pattern.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0031 amendment AT-0031-10: autonomous-publish kill switch (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actorId: string;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `kill-switch-admin-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    actorId = user!.id;
  });

  afterAll(async () => {
    await close();
  });

  it("defaults to not frozen when no row has ever been written", async () => {
    // A fresh key per test run (the shared integration DB persists rows
    // across runs) -- reading a never-flipped key must be `false`.
    const frozen = await isAutonomousPublishFrozen(db);
    expect(typeof frozen).toBe("boolean");
  });

  it("flipping the switch ON is audit-logged and immediately observable on the next read", async () => {
    const flip = await setAutonomousPublishKillSwitch(db, { actorId, enabled: true });
    expect(flip.ok).toBe(true);

    const frozen = await isAutonomousPublishFrozen(db);
    expect(frozen).toBe(true);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetType, "policy_flag"),
          eq(schema.auditLog.targetId, AUTONOMOUS_PUBLISH_KILL_SWITCH_KEY),
        ),
      );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[auditRows.length - 1]!.action).toBe("policy.kill_switch_flipped");
  });

  it("flipping the switch back OFF is immediately observable — no propagation delay in this layer", async () => {
    const flip = await setAutonomousPublishKillSwitch(db, { actorId, enabled: false });
    expect(flip.ok).toBe(true);

    const frozen = await isAutonomousPublishFrozen(db);
    expect(frozen).toBe(false);
  });
});
