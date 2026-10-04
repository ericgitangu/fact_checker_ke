import { eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { EditorialResult } from "./flywheel.js";
import { writeAuditLog } from "./audit.js";

/**
 * ADR-0030 "creator-funnel conflict-of-interest firewall" (AT-0030-1):
 * records that a founder-channel (YouTube/TikTok) post referenced a
 * specific check, enforcing the ADR's "source restriction" rule at write
 * time rather than trusting the caller — a post can never be recorded
 * against a check that isn't published yet, and can never claim to have
 * gone out before the check was published. `migrations/0011`'s
 * `funnel_audit_log_posted_after_published` CHECK constraint is the
 * second (database-level) line of defense for the same invariant; this
 * function is the first, and returns a typed error instead of letting a
 * caller discover the DB constraint via a raw SQL error.
 *
 * This is the audit trail only (rule 3 of
 * docs/architecture/creator-funnel-firewall.md) — it does not gate
 * publishing on any platform and is not read by the editor queue or any
 * claim-priority logic (rule 2: editorial independence from funnel
 * metrics is enforced by no code path existing that reads this table
 * for that purpose).
 */
export async function recordFunnelPost(
  db: Database,
  args: {
    actorId: string;
    checkId: string;
    funnelPostUrl: string;
    postedAt: Date;
    platform: "youtube" | "tiktok" | "other";
    aiDisclosed: boolean;
    revenueCents?: number | null;
  },
): Promise<EditorialResult<{ id: string }>> {
  const [check] = await db
    .select({ id: schema.checks.id, publishedAt: schema.checks.publishedAt })
    .from(schema.checks)
    .where(eq(schema.checks.id, args.checkId))
    .limit(1);

  if (!check) {
    return { ok: false, error: { kind: "not_found", message: `Check ${args.checkId} not found.` } };
  }
  if (!check.publishedAt) {
    return {
      ok: false,
      error: {
        kind: "not_published",
        message: "ADR-0030 source restriction: the funnel may only reference an already-published check.",
      },
    };
  }
  if (args.postedAt.getTime() < check.publishedAt.getTime()) {
    return {
      ok: false,
      error: {
        kind: "invalid_timing",
        message: "ADR-0030 source restriction: the funnel post predates the check's publication.",
      },
    };
  }

  let id = "";
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.funnelAuditLog)
      .values({
        checkId: args.checkId,
        publishedAt: check.publishedAt as Date,
        funnelPostUrl: args.funnelPostUrl,
        postedAt: args.postedAt,
        platform: args.platform,
        aiDisclosed: args.aiDisclosed,
        revenueCents: args.revenueCents ?? null,
        recordedBy: args.actorId,
      })
      .returning();
    id = row!.id;

    await writeAuditLog(tx, {
      actorId: args.actorId,
      action: "funnel.post_recorded",
      targetType: "check",
      targetId: args.checkId,
      metadata: { funnelPostUrl: args.funnelPostUrl, platform: args.platform, aiDisclosed: args.aiDisclosed },
    });
  });

  return { ok: true, value: { id } };
}
