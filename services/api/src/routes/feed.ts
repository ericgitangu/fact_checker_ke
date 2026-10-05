import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FeedResponse } from "@fact-checker-ke/core";
import type { CheckRepository } from "../repositories/types.js";
import { FEED_CACHE_CONTROL } from "../lib/cache-headers.js";

const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().datetime().optional(),
});

const DEFAULT_LIMIT = 20;
/** "Most viral right now" shows the top 3 (task brief Part 2). */
const TOP_VIRAL_LIMIT = 3;

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
}
