import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@fact-checker-ke/db";
import type { AuthService } from "../lib/auth/service.js";
import { requireRole } from "../lib/auth/middleware.js";
import { blockCommenter, getModerationQueue, listVisibleComments, moderateComment, postComment, reportComment } from "../lib/moderation.js";

const PostCommentBodySchema = z.object({ body: z.string().min(1).max(2000) });
const BlockBodySchema = z.object({ blockedDeviceToken: z.string().min(1) });
const ModerateBodySchema = z.object({ decision: z.enum(["release", "reject", "hide"]) });

function deviceToken(request: { headers: Record<string, unknown> }): string | null {
  const header = (request.headers as Record<string, string | string[] | undefined>)["x-device-token"];
  return Array.isArray(header) ? (header[0] ?? null) : (header ?? null);
}

/**
 * ADR-0024: comments on published checks only. Public routes use the
 * ADR-0020 device token (`X-Device-Token`, same header as submissions)
 * for accountability without requiring a full account; moderator/editor/
 * admin routes reuse the ADR-0020 session middleware.
 */
export async function commentRoutes(app: FastifyInstance, deps: { db: Database; auth: AuthService }): Promise<void> {
  const { db, auth } = deps;
  // ADR-0024 §7: moderator scope is comment moderation ONLY -- editor/
  // admin can also moderate (a superset of capability), but moderator
  // must be REJECTED on any publish/correction/kill-switch route
  // (AT-0024-5), which is exactly why editor.ts's `guard` above never
  // includes "moderator".
  const moderationGuard = requireRole(auth, ["moderator", "editor", "admin"]);

  app.post<{ Params: { checkId: string } }>("/v1/checks/:checkId/comments", async (request, reply) => {
    const parsed = PostCommentBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const token = deviceToken(request);
    if (!token) return reply.status(400).send({ error: "device_token_required" });

    const result = await postComment(db, { checkId: request.params.checkId, authorDeviceToken: token, body: parsed.data.body });
    if (!result.ok) {
      const status = result.error.kind === "not_found" ? 404 : result.error.kind === "comments_disabled_ongoing_event" ? 403 : 422;
      return reply.status(status).send({ error: result.error.kind, message: result.error.message });
    }
    return reply.status(201).send(result.value);
  });

  app.get<{ Params: { checkId: string } }>("/v1/checks/:checkId/comments", async (request, reply) => {
    const comments = await listVisibleComments(db, request.params.checkId, deviceToken(request));
    return reply.status(200).send({ items: comments });
  });

  app.post<{ Params: { id: string } }>("/v1/comments/:id/report", async (request, reply) => {
    const token = deviceToken(request);
    if (!token) return reply.status(400).send({ error: "device_token_required" });
    const result = await reportComment(db, request.params.id, token);
    if (!result.ok) return reply.status(404).send({ error: result.error.kind, message: result.error.message });
    return reply.status(200).send(result.value);
  });

  app.post("/v1/comments/block", async (request, reply) => {
    const parsed = BlockBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const token = deviceToken(request);
    if (!token) return reply.status(400).send({ error: "device_token_required" });
    const result = await blockCommenter(db, token, parsed.data.blockedDeviceToken);
    return reply.status(200).send(result.ok ? result.value : { error: result.error });
  });

  // Apple App Store Guideline 1.2: "published contact information" for
  // abuse reports, distinct from the general feedback channel
  // (AT-0024-4). A static route is sufficient -- no DB lookup needed for
  // a fixed contact path.
  app.get("/v1/abuse-contact", async (_request, reply) => {
    return reply.status(200).send({
      contact: "abuse@fact-checker.ke",
      distinctFrom: "general feedback is a separate channel; this is the report/content abuse route (Apple 1.2).",
    });
  });

  app.get("/v1/moderation/queue", { preHandler: moderationGuard }, async (_request, reply) => {
    const queue = await getModerationQueue(db);
    return reply.status(200).send({ items: queue });
  });

  app.post<{ Params: { id: string } }>("/v1/moderation/comments/:id", { preHandler: moderationGuard }, async (request, reply) => {
    const parsed = ModerateBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const result = await moderateComment(db, request.authUser!.id, request.params.id, parsed.data.decision);
    if (!result.ok) return reply.status(404).send({ error: result.error.kind, message: result.error.message });
    return reply.status(200).send(result.value);
  });
}
