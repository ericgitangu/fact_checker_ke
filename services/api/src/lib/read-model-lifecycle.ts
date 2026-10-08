import type { Check, CheckLifecycle, FeedItem, IngestSource, Rating, RiskTier, TrendingItem } from "@fact-checker-ke/core";
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

/**
 * ADR-0038 Wave 3 (public surface for open claim threads). One row in the
 * unified home feed, which — unlike the published-only `FeedItem` — mixes
 * PUBLISHED verdicts with OPEN THREADS (`preliminary` / `awaiting_sources`).
 *
 * It is a STRUCTURAL SUPERSET of `FeedItem` with three deliberate differences
 * an open thread forces (and which `FeedItem`, whose `rating` is non-nullable
 * and whose `publishedAt` is required, cannot represent — packages/core is
 * fenced this wave, so this shape lives here in services/api):
 *   - `rating` is NULLABLE — withheld for an open thread unless the Wave-3
 *     stance-visibility rule exposes it (see `homeFeedExposedRating`). A
 *     named-person (riskTier 'C') item NEVER carries a rating pre-publish.
 *   - `publishedAt` is NULLABLE — an open thread has never been published.
 *   - `createdAt` is carried (the keyset's secondary sort key) and `sourceCount`
 *     is the count of cited sources (an open thread may have 0).
 * Everything else matches `FeedItem` so the web renders both through ONE card.
 */
export interface HomeFeedItem extends LifecycleReadFields {
  id: string;
  /** `checks.summary` — the claim under examination (same as `FeedItem.claim`). */
  claim: string;
  /** NULL unless exposed by the Wave-3 stance rule (`homeFeedExposedRating`). */
  rating: Rating | null;
  calibratedConfidence: number | null;
  ingestSource: IngestSource;
  riskTier: RiskTier | null;
  whatWouldChangeThis: string | null;
  context: string | null;
  sources: FeedItemWithLifecycle["sources"];
  /** Count of cited sources — 0 for most open threads, N for a published verdict. */
  sourceCount: number;
  viralityScore: number | null;
  /** The keyset's secondary sort key (ISO); present on every row. */
  createdAt: string;
  /** NULL for an open thread; the publish timestamp for a published verdict. */
  publishedAt: string | null;
}

/**
 * ADR-0038 Wave 3 stance-visibility rule (the owner's explicit ask), enforced
 * at the READ boundary as defence-in-depth over the persistence rule in the
 * orchestrators. Decides whether a row's stored `rating` reaches the public:
 *   - a PUBLISHED verdict always exposes its rating (it IS the verdict);
 *   - an OPEN THREAD exposes the AI's draft stance ONLY when it is
 *     non-authoritative (`authoritative === false`, an AI-grounded preliminary)
 *     AND NOT a named-person high-stakes item (`riskTier !== 'C'`);
 *   - everything else (named-person 'C', an authoritative-but-unpublished row,
 *     `awaiting_sources` with no draft rating) is WITHHELD → null.
 * This never fabricates a rating — it only gates the stored one; a named-person
 * 'C' row's rating is withheld here even if one were ever persisted upstream.
 */
export function homeFeedExposedRating(row: {
  isPublished: boolean;
  rating: Rating | null;
  authoritative: boolean;
  riskTier: RiskTier | null;
}): Rating | null {
  if (row.isPublished) return row.rating;
  if (row.authoritative === false && row.riskTier !== "C") return row.rating;
  return null;
}

/**
 * ADR-0038 Wave 3 keyset cursor over `(virality_score DESC NULLS LAST,
 * created_at DESC, id DESC)`. `v` is the RAW numeric string (not a JS number)
 * so an equal-virality page boundary compares exactly in Postgres
 * (`::numeric`) without float round-trip drift; `null` marks the NULLS-LAST
 * region. Opaque to the client (base64url JSON tuple) — never a column value in
 * the URL, and resilient to a malformed/old cursor (decode returns null → the
 * request is served as a first page rather than erroring).
 */
export interface HomeFeedCursor {
  v: string | null;
  c: string;
  id: string;
}

export function encodeHomeFeedCursor(cursor: HomeFeedCursor): string {
  return Buffer.from(JSON.stringify([cursor.v, cursor.c, cursor.id]), "utf8").toString("base64url");
}

export function decodeHomeFeedCursor(raw: string): HomeFeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [v, c, id] = parsed;
    if ((v !== null && typeof v !== "string") || typeof c !== "string" || typeof id !== "string") return null;
    return { v, c, id };
  } catch {
    return null;
  }
}
