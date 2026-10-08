import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FeedResponse } from "@fact-checker-ke/core";
import type { CheckRepository } from "../repositories/types.js";
import { FEED_CACHE_CONTROL } from "../lib/cache-headers.js";

const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().datetime().optional(),
});

/**
 * ADR-0038 Wave 3 home feed query. `cursor` is the OPAQUE keyset token the
 * previous page returned (base64url of a `(virality, created_at, id)` tuple) —
 * NOT a datetime like the legacy `/v1/feed` cursor — so it is validated only as
 * a bounded string; a malformed/stale value is tolerated by the repo (served as
 * a first page), never a 500.
 */
const HomeFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

const DEFAULT_LIMIT = 20;
/** "Most viral right now" shows the top 3 (task brief Part 2). */
const TOP_VIRAL_LIMIT = 3;
/** Each highlight rail (Most viral / Most recent) on the home page. */
const RAIL_LIMIT = 3;

/**
 * ADR-0032's visible payoff: `GET /v1/feed` — recently PUBLISHED checks
 * (`isDraft=false AND publishedAt IS NOT NULL`), newest first, mixing
 * both ingestion engines (ADR-0032 AT-0032-6's `ingest_source`
 * provenance rides along on every item). Read-only, cache-friendly
 * (ADR-0018-style headers — see `FEED_CACHE_CONTROL`), keyset-paginated
 * so a concurrent publish never skips/duplicates a row the way an
 * offset would under insertion at the head of the ordering.
 */
export async function feedRoutes(app: FastifyInstance, deps: { checks: CheckRepository }): Promise<void> {
  app.get("/v1/feed", async (request, reply) => {
    const parsed = FeedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    // Additive, backward-compatible: the descending keyset feed is unchanged;
    // the "most viral right now" top-3 is computed over ALL published rows
    // alongside it. Only the first page carries it — a reader paginating
    // "load older" has already seen the viral section, and recomputing it on
    // every page would be wasted work.
    const isFirstPage = !parsed.data.cursor;
    const [items, topViral] = await Promise.all([
      deps.checks.listPublished({ limit, cursor: parsed.data.cursor ?? null }),
      isFirstPage ? deps.checks.listTopViral({ limit: TOP_VIRAL_LIMIT }) : Promise.resolve([]),
    ]);

    const nextCursor = items.length === limit ? (items[items.length - 1]?.publishedAt ?? null) : null;

    const body: FeedResponse = { items, nextCursor, topViral };

    reply.header("Cache-Control", FEED_CACHE_CONTROL);
    return reply.status(200).send(body);
  });

  /**
   * ADR-0038 Wave 3: `GET /v1/feed/home` — the UNIFIED public home feed that
   * finally SURFACES OPEN THREADS. Unlike `/v1/feed` (published-only, which is
   * left untouched for backward compatibility and the core `ApiClient`'s
   * strict `FeedResponseSchema`), this interleaves PUBLISHED verdicts with
   * `preliminary`/`awaiting_sources` threads — so the AI-grounded preliminaries
   * (including reader-submitted ones) are visible. `editor_review` (private
   * queue), `dismissed` and `archived_expired` are excluded.
   *
   * A sibling read rather than an extension of `/v1/feed` precisely because an
   * open thread's `rating` is NULLABLE (withheld for named persons; the AI
   * draft stance for non-named preliminaries) — which `FeedItem`'s non-nullable
   * `rating` cannot represent, and packages/core is fenced this wave.
   *
   * Keyset pagination on `(virality_score DESC NULLS LAST, created_at DESC,
   * id)`. The two highlight rails (`mostViral`, `mostRecent`) are first-page
   * only (a reader paging "load more" has already seen them), exactly like the
   * legacy `topViral` section above.
   */
  app.get("/v1/feed/home", async (request, reply) => {
    const parsed = HomeFeedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    const isFirstPage = !parsed.data.cursor;
    const [page, mostViral, mostRecent] = await Promise.all([
      deps.checks.listHomeFeed({ limit, cursor: parsed.data.cursor ?? null }),
      isFirstPage ? deps.checks.listHomeRailViral({ limit: RAIL_LIMIT }) : Promise.resolve([]),
      isFirstPage ? deps.checks.listHomeRailRecent({ limit: RAIL_LIMIT }) : Promise.resolve([]),
    ]);

    reply.header("Cache-Control", FEED_CACHE_CONTROL);
    return reply.status(200).send({
      items: page.items,
      nextCursor: page.nextCursor,
      mostViral,
      mostRecent,
    });
  });
}
