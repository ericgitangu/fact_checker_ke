import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { isFetchEngineFrozen, setFetchEngineKillSwitch } from "../lib/fetch-kill-switch.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * ADR-0032 (two-engine pivot) / AT-0032-6: the fetch-engine kill switch —
 * defaults live, flips are audited, and the flip is visible to the very
 * next read (no caching layer).
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0032 fetch-engine kill switch (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actorId: string;

  beforeAll(async () => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
    const [user] = await db
      .insert(schema.users)
      .values({ email: `fetch-kill-switch-${randomUUID()}@example.test`, passwordHash: "x", role: "admin" })
      .returning();
    actorId = user!.id;
  });

  afterAll(async () => {
    await close();
  });

  it("defaults to NOT frozen when no flag row exists", async () => {
    expect(await isFetchEngineFrozen(db)).toBe(false);
  });

  it("flipping it on is visible on the very next read, and is audit-logged", async () => {
    const result = await setFetchEngineKillSwitch(db, { actorId, enabled: true });
    expect(result.ok).toBe(true);
    expect(await isFetchEngineFrozen(db)).toBe(true);

    const auditRows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, actorId));
    expect(auditRows.some((row) => row.action === "policy.kill_switch_flipped")).toBe(true);
  });

  it("flipping it back off restores live ingestion/publishing on the next read", async () => {
    await setFetchEngineKillSwitch(db, { actorId, enabled: true });
    expect(await isFetchEngineFrozen(db)).toBe(true);
    await setFetchEngineKillSwitch(db, { actorId, enabled: false });
    expect(await isFetchEngineFrozen(db)).toBe(false);
  });
});
