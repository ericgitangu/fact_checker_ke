import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, type Database } from "@fact-checker-ke/db";
import { correctCheck } from "../lib/editorial.js";
import { captureUserSignal } from "../lib/flywheel.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

/**
 * AT-0031-4: An editor correction and a user dispute are persisted as
 * labeled training/eval rows (flywheel capture).
 *
 * Exercises the REAL code paths: `correctCheck` (services/api/src/lib/
 * editorial.ts, unmodified call signature — only additively wired to
 * also call `captureEditorCorrection`) and `captureUserSignal`
 * (services/api/src/lib/flywheel.ts), both against a real Postgres
 * instance — not a replica of the persistence logic.
 */
const connectionString = requireIntegrationDatabaseUrl();

describe.skipIf(!connectionString)("ADR-0031 flywheel capture (AT-0031-4, integration)", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(() => {
    const created = createDb(connectionString as string);
    db = created.db;
    close = created.close;
  });

  afterAll(async () => {
    await close();
  });

  it("an editor correction is persisted as a labeled editor_correction row", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `editor-${randomUUID()}@example.test`, passwordHash: "x", role: "editor" })
      .returning();
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `flywheel-${randomUUID()}` })
      .returning();
    const [original] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "Original published summary.",
        rating: "MostlyTrue",
        isDraft: false,
        publishedAt: new Date(),
      })
      .returning();

    const result = await correctCheck(db, user!.id, original!.id, {
      summary: "Corrected summary after reader feedback.",
      rating: "False",
      notes: "Reader pointed out a dated source; verified and corrected.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const labelRows = await db
      .select()
      .from(schema.trainingEvalLabels)
      .where(eq(schema.trainingEvalLabels.checkId, result.value.newCheckId));
    expect(labelRows).toHaveLength(1);
    expect(labelRows[0]!.source).toBe("editor_correction");
    expect(labelRows[0]!.actorRef).toBe(user!.id);
    const label = labelRows[0]!.label as { previousCheckId: string; correctedRating: string };
    expect(label.previousCheckId).toBe(original!.id);
    expect(label.correctedRating).toBe("False");
  });

  it("a user dispute signal on a published check is persisted as a labeled user_dispute row", async () => {
    const [submission] = await db
      .insert(schema.submissions)
      .values({ url: null, text: `flywheel-dispute-${randomUUID()}` })
      .returning();
    const [check] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "A published check a reader disputes.",
        rating: "Unproven",
        isDraft: false,
        publishedAt: new Date(),
      })
      .returning();

    const result = await captureUserSignal(db, {
      checkId: check!.id,
      deviceTokenHash: "a".repeat(64),
      signal: "dispute",
      reason: "I have a newer source that contradicts this.",
    });
    expect(result.ok).toBe(true);

    const labelRows = await db
      .select()
      .from(schema.trainingEvalLabels)
      .where(eq(schema.trainingEvalLabels.checkId, check!.id));
    expect(labelRows).toHaveLength(1);
    expect(labelRows[0]!.source).toBe("user_dispute");
    expect(labelRows[0]!.actorRef).toBe("a".repeat(64));

    // An agree signal on a DIFFERENT check is distinguishable by source.
    const [agreeTarget] = await db
      .insert(schema.checks)
      .values({
        submissionId: submission!.id,
        summary: "A second published check a reader agrees with.",
        rating: "True",
        isDraft: false,
        publishedAt: new Date(),
      })
      .returning();
    const agreeResult = await captureUserSignal(db, {
      checkId: agreeTarget!.id,
      deviceTokenHash: "b".repeat(64),
      signal: "agree",
      reason: null,
    });
    expect(agreeResult.ok).toBe(true);
    const agreeRows = await db
      .select()
      .from(schema.trainingEvalLabels)
      .where(eq(schema.trainingEvalLabels.checkId, agreeTarget!.id));
    expect(agreeRows[0]!.source).toBe("user_agree");
  });

  it("captureUserSignal returns not_found for a nonexistent check", async () => {
    const result = await captureUserSignal(db, {
      checkId: randomUUID(),
      deviceTokenHash: "c".repeat(64),
      signal: "agree",
      reason: null,
    });
    expect(result.ok).toBe(false);
  });
});
