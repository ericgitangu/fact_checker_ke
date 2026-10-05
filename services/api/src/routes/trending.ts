import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TrendingResponse } from "@fact-checker-ke/core";
import type { TrendingRepository } from "../repositories/types.js";
import { FEED_CACHE_CONTROL } from "../lib/cache-headers.js";

const TrendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const DEFAULT_LIMIT = 20;

/**
 * `GET /v1/trending` — the "Trending / under review" stream (ADR-0032
 * refinement). Surfaces fetch-DISCOVERED viral items (`submissions`, not
 * published checks) ordered by virality, each with a DERIVED status
 * (monitoring / under_review / published / dismissed), so "we catch what's
 * trending" is visible immediately — regardless of whether the item became a
 * published check. Read-only, cache-friendly (same freshness as the feed).
 *
 * It exposes ONLY the discovered video's own metadata plus the derived status
 * (and a checkId only when a published check exists). It NEVER exposes a held
 * draft's rating/summary — decision C (the editor queue and the publish/
 * evidence guards) is untouched, and a draft's verdict is not public.
 *
 * No kill-switch: like `GET /v1/feed`, this is a read-side list, not an
 * ingestion/publish surface. The fetch-engine/autonomous-publish kill switches
 * already gate what gets DISCOVERED and PUBLISHED upstream; this endpoint only
 * reflects what those produced.
 */
export async function trendingRoutes(app: FastifyInstance, deps: { trending: TrendingRepository }): Promise<void> {
  app.get("/v1/trending", async (request, reply) => {
    const parsed = TrendingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const limit = parsed.data.limit ?? DEFAULT_LIMIT;
    const items = await deps.trending.listTrending({ limit });

    const body: TrendingResponse = { items };

    reply.header("Cache-Control", FEED_CACHE_CONTROL);
    return reply.status(200).send(body);
  });
}
