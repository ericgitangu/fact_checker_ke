import { asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type {
  Demonstration,
  DemonstrationMedia,
  DemonstrationMediaMisinfoStatus,
  DemonstrationMediaPlatform,
  DemonstrationStatus,
  DemonstrationStatusEvent,
  MaandamanoArchiveResponse,
  MaandamanoResponse,
} from "@fact-checker-ke/core";
import { isPlatformEmbedHost } from "@fact-checker-ke/core";
import { updatePolicyFlag, type PolicyAuditResult } from "./policy-audit.js";
import { writeAuditLog } from "./audit.js";
import type { Publisher } from "./publisher.js";

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A). The switch is modelled as
 * an ordinary audited `policy_flags` row (reusing ADR-0031's
 * `updatePolicyFlag`, see docs/runbooks/nc4-kill-switch.md Step 2.1) —
 * no new table/migration. Defaults OFF: a missing row (nothing has ever
 * flipped it) means `isMaandamanoFrozen` returns `false`.
 */
export const MAANDAMANO_KILL_SWITCH_KEY = "maandamano_kill_switch";

export async function isMaandamanoFrozen(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: schema.policyFlags.value })
    .from(schema.policyFlags)
    .where(eq(schema.policyFlags.key, MAANDAMANO_KILL_SWITCH_KEY));
  return row?.value === true;
}

/**
 * The audited flip (runbook Step 2.1). Goes through `updatePolicyFlag`
 * so the flip is written in the SAME transaction as an `audit_log` row
 * (`action: 'policy.kill_switch_flipped'`, `target_id:
 * 'maandamano_kill_switch'`, `metadata.value` the new boolean) — see
 * services/api/src/lib/policy-audit.ts. This function does NOT trigger
 * ISR revalidation itself (that's the route handler's job, see
 * routes/maandamano.ts) so this stays testable against a bare DB
 * without a running web app.
 */
export async function setMaandamanoKillSwitch(
  db: Database,
  args: { actorId: string; enabled: boolean },
): Promise<PolicyAuditResult<{ key: string; enabled: boolean }>> {
  const result = await updatePolicyFlag(db, {
    actorId: args.actorId,
    key: MAANDAMANO_KILL_SWITCH_KEY,
    value: args.enabled,
    auditAction: "policy.kill_switch_flipped",
  });
  if (!result.ok) return result;
  return { ok: true, value: { key: MAANDAMANO_KILL_SWITCH_KEY, enabled: args.enabled } };
}

function toDemonstration(
  row: typeof schema.demonstrations.$inferSelect,
  media: DemonstrationMedia[] = [],
): Demonstration {
  return {
    id: row.id,
    title: row.title,
    area: row.area,
    county: row.county,
    status: row.status,
    date: row.date,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    updatedAt: row.updatedAt.toISOString(),
    media,
  };
}

function toMedia(row: typeof schema.demonstrationMedia.$inferSelect): DemonstrationMedia {
  return {
    id: row.id,
    // `platform` is a plain text column at the DB layer; the attach path
    // (attachDemonstrationMedia) only ever writes an allowlisted platform,
    // so this cast re-narrows it to the contract enum for the response.
    platform: row.platform as DemonstrationMediaPlatform,
    embedUrl: row.embedUrl,
    caption: row.caption,
    observedAt: row.observedAt.toISOString(),
    misinfoStatus: row.misinfoStatus,
    misinfoNote: row.misinfoNote,
  };
}

/**
 * ADR-0035: fetch all embeds for the given demonstration ids and group
 * them by `demonstrationId`, oldest-observed first. One extra query (not
 * N+1) for the whole page. Returns an empty map when there are no ids.
 */
async function loadMediaByDemonstration(
  db: Database,
  demonstrationIds: string[],
): Promise<Map<string, DemonstrationMedia[]>> {
  const byDemo = new Map<string, DemonstrationMedia[]>();
  if (demonstrationIds.length === 0) return byDemo;
  const rows = await db
    .select()
    .from(schema.demonstrationMedia)
    .where(inArray(schema.demonstrationMedia.demonstrationId, demonstrationIds))
    .orderBy(asc(schema.demonstrationMedia.observedAt));
  for (const row of rows) {
    const list = byDemo.get(row.demonstrationId) ?? [];
    list.push(toMedia(row));
    byDemo.set(row.demonstrationId, list);
  }
  return byDemo;
}

/**
 * ADR-0007 AT-0007-A server-side enforcement: the ONE function that
 * decides what a reader (public `GET /v1/maandamano`, and apps/web's
 * server-side render of `/maandamano` through it) gets to see. While
 * frozen, this NEVER queries/returns `schema.demonstrations` rows —
 * `demonstrations` is hardcoded `[]`, not merely omitted from a
 * client-side render. There is no code path in this module, or in
 * routes/maandamano.ts, that reaches the demonstrations table while
 * `frozen` is true; a reader cannot retrieve the live list by calling
 * the API directly, only by an operator flipping the switch back.
 */
export async function getMaandamanoAdvisories(db: Database): Promise<MaandamanoResponse> {
  const frozen = await isMaandamanoFrozen(db);
  if (frozen) {
    // ADR-0035 AT-0035-4: the frozen branch is UNCHANGED — it returns
    // `demonstrations: []` WITHOUT reading the demonstrations table, so no
    // media is read either (media hangs off demonstrations). The kill
    // switch covers the new embeds for free through this same gate.
    return { frozen: true, demonstrations: [] };
  }
  const rows = await db.select().from(schema.demonstrations).orderBy(schema.demonstrations.updatedAt);
  const mediaByDemo = await loadMediaByDemonstration(
    db,
    rows.map((r) => r.id),
  );
  return { frozen: false, demonstrations: rows.map((row) => toDemonstration(row, mediaByDemo.get(row.id) ?? [])) };
}

/**
 * ADR-0035 archive read model (AT-0035-5): `ended`/`cancelled` advisories
 * with their status history + source/embed links, never raw media
 * (embeds are links). Kill-switch-gated through the SAME `isMaandamanoFrozen`
 * check as the live list (AT-0035-4): while frozen this returns
 * `{ frozen: true, archived: [] }` WITHOUT touching any demonstration
 * table. `ongoing`/`announced`/etc. advisories are excluded — only the
 * terminal states are archived, newest-ended first (by `updatedAt`).
 */
export async function getMaandamanoArchive(db: Database): Promise<MaandamanoArchiveResponse> {
  const frozen = await isMaandamanoFrozen(db);
  if (frozen) {
    return { frozen: true, archived: [] };
  }
  const rows = await db
    .select()
    .from(schema.demonstrations)
    .where(inArray(schema.demonstrations.status, ["ended", "cancelled"]))
    .orderBy(desc(schema.demonstrations.updatedAt));

  const ids = rows.map((r) => r.id);
  const mediaByDemo = await loadMediaByDemonstration(db, ids);

  const historyByDemo = new Map<string, DemonstrationStatusEvent[]>();
  if (ids.length > 0) {
    const events = await db
      .select()
      .from(schema.demonstrationStatusEvents)
      .where(inArray(schema.demonstrationStatusEvents.demonstrationId, ids))
      .orderBy(asc(schema.demonstrationStatusEvents.occurredAt));
    for (const ev of events) {
      const list = historyByDemo.get(ev.demonstrationId) ?? [];
      list.push({ status: ev.status, note: ev.note, occurredAt: ev.occurredAt.toISOString() });
      historyByDemo.set(ev.demonstrationId, list);
    }
  }

  return {
    frozen: false,
    archived: rows.map((row) => ({
      ...toDemonstration(row, mediaByDemo.get(row.id) ?? []),
      statusHistory: historyByDemo.get(row.id) ?? [],
    })),
  };
}

export type MaandamanoMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: "not_found" | "validation_error"; message: string } };

/**
 * ADR-0035 (AT-0035-2/3/6): an authenticated editor/admin attaches an
 * iframe embed to an advisory. Human-curated: this is the ONLY write path
 * to `demonstration_media`, and it is reached only from an admin/editor
 * POST (routes/maandamano.ts) — no pipeline/fetch code path writes this
 * table (AT-0035-6).
 *
 * Writes the `demonstration_media` row (`misinfoStatus: 'unchecked'`) and
 * an `audit_log` row in ONE transaction (the audited-mutation pattern),
 * then — AFTER commit — enqueues a misinfo-triage job to services/pipeline
 * so EVERY embed is routed through the reverse-image/synthetic-media check
 * (AT-0035-3). The embed can be live (`misinfoStatus: 'checking'`) before
 * the check returns (ADR-0035 trade-off 3); the badge updates on callback.
 *
 * `embedUrl`'s host is re-checked here against the platform allowlist
 * (`isPlatformEmbedHost`) — the structural block on a re-hosted/arbitrary
 * URL (AT-0035-2) — belt-and-suspenders with the route's zod parse.
 */
export async function attachDemonstrationMedia(
  db: Database,
  args: {
    actorId: string;
    demonstrationId: string;
    platform: DemonstrationMediaPlatform;
    embedUrl: string;
    caption: string | null;
    observedAt: string;
    /** Optional: enqueues the misinfo-triage job when provided (the route
     * always provides it; a bare-DB test may omit it). */
    enqueueTriage?: {
      publisher: Publisher;
      mediaTriageUrl: string;
    };
  },
): Promise<MaandamanoMutationResult<{ media: DemonstrationMedia }>> {
  if (!isPlatformEmbedHost(args.embedUrl)) {
    return {
      ok: false,
      error: {
        kind: "validation_error",
        message: "embedUrl host must be a platform embed/oEmbed host (ADR-0035 — embeds only, never re-hosted bytes).",
      },
    };
  }

  const [demo] = await db
    .select({ id: schema.demonstrations.id })
    .from(schema.demonstrations)
    .where(eq(schema.demonstrations.id, args.demonstrationId));
  if (!demo) {
    return { ok: false, error: { kind: "not_found", message: "demonstration not found" } };
  }

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.demonstrationMedia)
      .values({
        demonstrationId: args.demonstrationId,
        platform: args.platform,
        embedUrl: args.embedUrl,
        caption: args.caption,
        observedAt: new Date(args.observedAt),
        misinfoStatus: "unchecked",
      })
      .returning();
    if (!row) throw new Error("insert into demonstration_media returned no row");
    await writeAuditLog(tx, {
      actorId: args.actorId,
      action: "demonstration.media_attached",
      targetType: "demonstration_media",
      targetId: row.id,
      metadata: { demonstrationId: args.demonstrationId, platform: args.platform, embedUrl: args.embedUrl },
    });
    return row;
  });

  // AFTER commit: route EVERY embed through the misinfo check (AT-0035-3).
  // Non-throwing / best-effort: a failed enqueue must not undo a committed,
  // audited attach (same discipline as the kill-switch revalidation
  // webhook). The embed simply stays `unchecked` until re-triaged.
  if (args.enqueueTriage) {
    try {
      await args.enqueueTriage.publisher.publish({
        url: args.enqueueTriage.mediaTriageUrl,
        body: {
          media_id: inserted.id,
          platform: args.platform,
          embed_url: args.embedUrl,
          // Thumbnail/frame reference the pipeline hashes for the reverse-
          // image check — NO download of third-party bytes (ADR-0002). The
          // embed URL doubles as the thumbnail reference here; a richer
          // oEmbed-thumbnail resolution is a pipeline-side concern.
          thumbnail_ref: args.embedUrl,
        },
        deduplicationId: `media-triage-${inserted.id}`,
      });
    } catch {
      // swallowed deliberately — see docblock above.
    }
  }

  return { ok: true, value: { media: toMedia(inserted) } };
}

/**
 * ADR-0035 (AT-0035-7): change a demonstration's status AND append a
 * `demonstration_status_events` row in the SAME transaction, so the
 * archive timeline is real rather than reconstructed. Human-curated: only
 * reachable from an admin/editor POST. Also writes an `audit_log` row in
 * the same transaction.
 */
export async function recordDemonstrationStatus(
  db: Database,
  args: { actorId: string; demonstrationId: string; status: DemonstrationStatus; note: string | null },
): Promise<MaandamanoMutationResult<{ status: DemonstrationStatus }>> {
  const [demo] = await db
    .select({ id: schema.demonstrations.id })
    .from(schema.demonstrations)
    .where(eq(schema.demonstrations.id, args.demonstrationId));
  if (!demo) {
    return { ok: false, error: { kind: "not_found", message: "demonstration not found" } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.demonstrations)
      .set({ status: args.status, updatedAt: new Date() })
      .where(eq(schema.demonstrations.id, args.demonstrationId));
    await tx.insert(schema.demonstrationStatusEvents).values({
      demonstrationId: args.demonstrationId,
      status: args.status,
      note: args.note,
      changedBy: args.actorId,
    });
    await writeAuditLog(tx, {
      actorId: args.actorId,
      action: "demonstration.status_changed",
      targetType: "demonstration",
      targetId: args.demonstrationId,
      metadata: { status: args.status, note: args.note },
    });
  });

  return { ok: true, value: { status: args.status } };
}

/**
 * ADR-0035: the pipeline → API write-back of an embed's misinfo-check
 * result (step 6). Sets `misinfoStatus` (`clear`/`flagged`), the editor-
 * facing note, and (when flagged) the denormalized earlier-copy URL so the
 * "may be recycled footage" caveat is self-contained. A no-op `not_found`
 * when the media row is gone (the advisory was deleted/cascade-removed
 * before the async check returned) — never an error.
 */
export async function applyMediaMisinfoResult(
  db: Database,
  args: {
    mediaId: string;
    status: Extract<DemonstrationMediaMisinfoStatus, "clear" | "flagged">;
    note: string | null;
    earlierUrl: string | null;
  },
): Promise<MaandamanoMutationResult<{ mediaId: string; status: DemonstrationMediaMisinfoStatus }>> {
  const updated = await db
    .update(schema.demonstrationMedia)
    .set({ misinfoStatus: args.status, misinfoNote: args.note, reverseImageEarlierUrl: args.earlierUrl })
    .where(eq(schema.demonstrationMedia.id, args.mediaId))
    .returning({ id: schema.demonstrationMedia.id });
  if (updated.length === 0) {
    return { ok: false, error: { kind: "not_found", message: "media not found" } };
  }
  return { ok: true, value: { mediaId: args.mediaId, status: args.status } };
}
