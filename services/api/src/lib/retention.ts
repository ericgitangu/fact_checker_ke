import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { hashDeviceToken } from "./device-token.js";
import { writeAuditLog } from "./audit.js";

export interface RetentionSweepResult {
  anonymousSubmissionsDeleted: number;
  namedPersonDraftsDeleted: number;
}

async function retentionDays(db: Database, dataClass: string): Promise<number | null> {
  const [row] = await db.select().from(schema.retentionPolicy).where(eq(schema.retentionPolicy.dataClass, dataClass)).limit(1);
  return row?.retentionDays ?? null;
}

/**
 * ADR-0021 AT-0021-1 (partially): sweeps anonymous, unpublished
 * submissions with no associated check (no claim found) past their
 * retention window, and unpublished named-person drafts past theirs.
 * Invoked from the EXISTING `/internal/outbox/drain` sweeper (task
 * brief: "NOT a new cron") — see services/api/src/routes/internal.ts.
 *
 * Deliberately NOT implemented in this pass (explicit stub, not a
 * silent gap — see docs/adr/0021's implementation notes):
 *   - Upload EXIF stripping / 24h GCS lifecycle deletion (AT-0021-2):
 *     no upload pipeline exists in services/api yet to strip EXIF from
 *     or delete (ADR-0006's upload path is pipeline/infra territory,
 *     outside this change's ownership).
 *   - Log-sink IP redaction for /maandamano/* (AT-0021-3): a Terraform/
 *     log-sink concern (infra/** is the infra agent's ownership), not a
 *     services/api runtime behaviour.
 *   - The privacy-notice snapshot test (AT-0021-5): apps/web territory.
 */
export async function runRetentionSweep(db: Database): Promise<RetentionSweepResult> {
  const anonymousDays = await retentionDays(db, "anonymous_submission_no_claim");
  const namedPersonDays = await retentionDays(db, "named_person_draft");

  let anonymousSubmissionsDeleted = 0;
  if (anonymousDays !== null) {
    // "No claim found" = no checks row references this submission at all.
    const result = await db.execute(sql`
      DELETE FROM submissions
      WHERE created_at < now() - interval '1 day' * ${anonymousDays}
        AND status != 'ready'
        AND NOT EXISTS (SELECT 1 FROM checks WHERE checks.submission_id = submissions.id)
    `);
    anonymousSubmissionsDeleted = (result as unknown as { count: number }).count ?? 0;
  }

  let namedPersonDraftsDeleted = 0;
  if (namedPersonDays !== null) {
    const staleDrafts = await db
      .select({ id: schema.checks.id })
      .from(schema.checks)
      .innerJoin(schema.claims, eq(schema.claims.checkId, schema.checks.id))
      .where(
        and(
          eq(schema.checks.isDraft, true),
          isNull(schema.checks.publishedAt),
          eq(schema.claims.namedPerson, true),
          lt(schema.checks.createdAt, new Date(Date.now() - namedPersonDays * 24 * 60 * 60 * 1000)),
        ),
      );
    const uniqueIds = [...new Set(staleDrafts.map((r) => r.id))];
    for (const id of uniqueIds) {
      await db.delete(schema.checks).where(eq(schema.checks.id, id));
      namedPersonDraftsDeleted += 1;
    }
  }

  return { anonymousSubmissionsDeleted, namedPersonDraftsDeleted };
}

/**
 * ADR-0021 "DSAR flow": a documented, manual export run by an editor
 * against a device token. Published-check evidence is NEVER included
 * (ADR-0021: not subject to erasure/export) — this function only reads
 * submissions/drafts/comments tied to the device hash.
 */
export async function runDsarExport(
  db: Database,
  actorId: string,
  deviceToken: string,
): Promise<{
  deviceTokenHash: string;
  submissions: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  excludedPublishedEvidence: true;
  exportedAt: string;
}> {
  const deviceTokenHash = hashDeviceToken(deviceToken);

  // This codebase's submissions table doesn't carry a device-token
  // column yet (submittedBy is a free-text field, not the ADR-0020
  // device token) -- tracked as tech debt below. Comments DO carry
  // authorDeviceHash, so that slice is real; submissions is a stub
  // returning an empty array with an explicit marker, not a silent
  // omission.
  const comments = await db.select().from(schema.comments).where(eq(schema.comments.authorDeviceHash, deviceTokenHash));

  await db.transaction(async (tx) => {
    await tx.insert(schema.dsarRequests).values({ requestedBy: actorId, deviceTokenHash });
    await writeAuditLog(tx, {
      actorId,
      action: "dsar.exported",
      targetType: "device_token_hash",
      targetId: deviceTokenHash,
      metadata: { commentCount: comments.length },
    });
  });

  return {
    deviceTokenHash,
    submissions: [], // STUB: submissions aren't keyed by device token hash yet -- see docblock above.
    comments: comments.map((c) => ({ id: c.id, checkId: c.checkId, body: c.body, status: c.status, createdAt: c.createdAt.toISOString() })),
    excludedPublishedEvidence: true,
    exportedAt: new Date().toISOString(),
  };
}
