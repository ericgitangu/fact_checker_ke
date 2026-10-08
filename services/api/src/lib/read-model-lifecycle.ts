import type { Check, CheckLifecycle, FeedItem, TrendingItem } from "@fact-checker-ke/core";
import type { schema } from "@fact-checker-ke/db";

/**
 * ADR-0038 contract B (api → web): the three editorial-lifecycle fields the
 * feed / trending / check read models expose so the web can derive each card's
 * next-step affordance. They are ADDITIVE and live ONLY here in services/api —
 * `packages/core`'s read-model zod schemas are intentionally NOT edited (hard
 * constraint for this wave), so these are threaded as a structural superset of
 * the core types. Fastify does not strip unknown response keys (no response
 * schema is attached to these routes), so the fields reach the wire. NOTE: the
 * core `ApiClient` DOES zod-strip them, so `apps/web` reads them with its own
 * extended fetch/parse (see apps/web/lib/get-feed.ts, get-trending.ts) rather
 * than through `ApiClient`.
 *
 * Field names are camelCase to match every other read-model field:
 *   - `lifecycleState`  — the ADR-0038 `check_lifecycle` enum, or null (a row
 *     backfilled before 0038, or created while the flag was off).
 *   - `authoritative`   — false marks a non-authoritative item (an AI-grounded
 *     preliminary / a named-person item whose rating must never be shown).
 *   - `sourceKind`      — tags the provenance of a non-verdict item, e.g.
 *     `'ai_grounded_preliminary'`; null for an ordinary check.
 */
export interface LifecycleReadFields {
  lifecycleState: CheckLifecycle | null;
  authoritative: boolean;
  sourceKind: string | null;
}

export type FeedItemWithLifecycle = FeedItem & LifecycleReadFields;
export type CheckWithLifecycle = Check & LifecycleReadFields;
export type TrendingItemWithLifecycle = TrendingItem & LifecycleReadFields;

/** Project the lifecycle fields off a raw `checks` row (or a thin projection
 * that carries them). `authoritative` is NOT NULL in the DB (default true), so
 * a nullish value coerces to `true` — a missing value never silently
 * down-ranks an item to non-authoritative. */
export function lifecycleFieldsOf(row: {
  lifecycleState: (typeof schema.checks.$inferSelect)["lifecycleState"];
  authoritative: (typeof schema.checks.$inferSelect)["authoritative"];
  sourceKind: (typeof schema.checks.$inferSelect)["sourceKind"];
}): LifecycleReadFields {
  return {
    lifecycleState: row.lifecycleState ?? null,
    authoritative: row.authoritative ?? true,
    sourceKind: row.sourceKind ?? null,
  };
}
