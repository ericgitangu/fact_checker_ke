import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { hashDeviceToken } from "./device-token.js";
import { writeAuditLog } from "./audit.js";

export interface RetentionSweepResult {
  anonymousSubmissionsDeleted: number;
  namedPersonDraftsDeleted: number;
  totpUsedCodesPruned: number;
}

/**
 * ADR-0020 review finding (data-lifecycle hardening pass): `totp_used_codes`
 * is the replay-prevention store keyed on `(user_id, counter)` — it exists
 * solely so a captured/observed TOTP code can't be replayed within its
 * valid window, and grows unbounded with no pruning anywhere in the
 * codebase before this change.
 *
 * Cutoff justification: `services/api/src/lib/auth/totp.ts` (RFC 6238)
 * uses a 30s step with a ±1 step drift window (`verifyTotpCode`/
 * `matchTotpCounter`), so a counter is only replay-relevant for at most
 * ~90 seconds after it was issued — once that window closes, the
 * authenticator app itself has moved on to a new code and the old one
 * can never validate again regardless of whether this row still exists.
 * 1 day is a wide, conservative safety margin over that ~90s window
 * (covers clock skew, long-running requests, and any future widening of
 * the drift window) while still bounding table growth to roughly one
 * day's worth of logins per user instead of forever.
 */
const TOTP_USED_CODE_PRUNE_CUTOFF_DAYS = 1;

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

  // ADR-0020 review finding: prune the TOTP replay store past its safe
  // cutoff -- see TOTP_USED_CODE_PRUNE_CUTOFF_DAYS docblock above.
  const totpPruneResult = await db.execute(sql`
    DELETE FROM totp_used_codes
    WHERE created_at < now() - interval '1 day' * ${TOTP_USED_CODE_PRUNE_CUTOFF_DAYS}
  `);
  const totpUsedCodesPruned = (totpPruneResult as unknown as { count: number }).count ?? 0;

  return { anonymousSubmissionsDeleted, namedPersonDraftsDeleted, totpUsedCodesPruned };
}

/**
 * ADR-0021 "DSAR flow": a documented, manual export run by an editor
 * against a device token. Published-check evidence is NEVER included
 * (ADR-0021: not subject to erasure/export) — this function only reads
 * submissions/drafts/comments tied to the device hash.
 *
 * AT-0021-4 closure (data-lifecycle hardening pass): `submissions` now
 * carries `deviceTokenHash` (migration 0011, written at creation time by
 * `services/api/src/routes/submissions.ts`) — the schema gap this
 * function used to stub out with an explicit empty array is closed.
 * "Drafts" are the unpublished checks (`isDraft: true` or
 * `publishedAt: null`) attached to this device's submissions; a
 * PUBLISHED check reachable from one of this device's submissions is
 * deliberately excluded from `submissions[].checks` too, not just from
 * a separate "evidence" field — ADR-0021 is explicit that published
 * checks are never subject to export/erasure, and a draft-shaped export
 * leaking a published verdict's content would defeat that rule by a
 * different door.
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

  const ownSubmissions = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.deviceTokenHash, deviceTokenHash));

  const submissionsExport: Array<Record<string, unknown>> = [];
  for (const submission of ownSubmissions) {
    const draftChecks = await db
      .select({ id: schema.checks.id, summary: schema.checks.summary, rating: schema.checks.rating, createdAt: schema.checks.createdAt })
      .from(schema.checks)
      .where(and(eq(schema.checks.submissionId, submission.id), isNull(schema.checks.publishedAt)));

    submissionsExport.push({
      id: submission.id,
      url: submission.url,
      text: submission.text,
      status: submission.status,
      createdAt: submission.createdAt.toISOString(),
      // Unpublished drafts only -- see docblock above for why a
      // published check is excluded here too, not only from a
      // separate "evidence" field.
      drafts: draftChecks.map((c) => ({ id: c.id, summary: c.summary, rating: c.rating, createdAt: c.createdAt.toISOString() })),
    });
  }

  // Comments DO carry authorDeviceHash directly, so that slice is real.
  const comments = await db.select().from(schema.comments).where(eq(schema.comments.authorDeviceHash, deviceTokenHash));

  await db.transaction(async (tx) => {
    await tx.insert(schema.dsarRequests).values({ requestedBy: actorId, deviceTokenHash });
    await writeAuditLog(tx, {
      actorId,
      action: "dsar.exported",
      targetType: "device_token_hash",
      targetId: deviceTokenHash,
      metadata: { commentCount: comments.length, submissionCount: submissionsExport.length },
    });
  });

  return {
    deviceTokenHash,
    submissions: submissionsExport,
    comments: comments.map((c) => ({ id: c.id, checkId: c.checkId, body: c.body, status: c.status, createdAt: c.createdAt.toISOString() })),
    excludedPublishedEvidence: true,
    exportedAt: new Date().toISOString(),
  };
}
