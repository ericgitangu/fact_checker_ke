import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@fact-checker-ke/db";
import type { AuthService } from "../lib/auth/service.js";
import { requireRole } from "../lib/auth/middleware.js";
import { recordFunnelPost } from "../lib/creator-funnel.js";

const RecordFunnelPostBodySchema = z.object({
  checkId: z.string().uuid(),
  funnelPostUrl: z.string().url().max(2000),
  postedAt: z.string().datetime(),
  platform: z.enum(["youtube", "tiktok", "other"]),
  aiDisclosed: z.boolean(),
  revenueCents: z.number().int().nonnegative().nullable().optional(),
});

/**
 * ADR-0030 (AT-0030-1): the creator-funnel conflict-of-interest firewall
 * audit trail's write path. Admin-only (currently: the founder is the
 * only funnel operator) — this is deliberately NOT exposed to `editor`,
 * since it records the founder's OWN conflict-of-interest-adjacent
 * activity, not ordinary editorial work.
 */
export async function funnelRoutes(app: FastifyInstance, deps: { db: Database; auth: AuthService }): Promise<void> {
  const { db, auth } = deps;
  const guard = requireRole(auth, ["admin"]);

  app.post("/v1/editor/funnel-posts", { preHandler: guard }, async (request, reply) => {
    const parsed = RecordFunnelPostBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const actor = request.authUser!;
    const body = parsed.data;

    const result = await recordFunnelPost(db, {
      actorId: actor.id,
      checkId: body.checkId,
      funnelPostUrl: body.funnelPostUrl,
      postedAt: new Date(body.postedAt),
      platform: body.platform,
      aiDisclosed: body.aiDisclosed,
      revenueCents: body.revenueCents ?? null,
    });

    if (!result.ok) {
      const status = result.error.kind === "not_found" ? 404 : result.error.kind === "not_published" || result.error.kind === "invalid_timing" ? 422 : 400;
      return reply.status(status).send({ error: result.error.kind, message: result.error.message });
    }

    return reply.status(201).send(result.value);
  });
}
