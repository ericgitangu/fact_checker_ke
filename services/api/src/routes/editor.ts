import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RatingSchema } from "@fact-checker-ke/core";
import type { Database } from "@fact-checker-ke/db";
import type { AuthService } from "../lib/auth/service.js";
import { requireRole } from "../lib/auth/middleware.js";
import {
  approveCheck,
  confirmQuoteAttribution,
  correctCheck,
  getEditorQueue,
  issueRightOfReply,
  recordRightOfReply,
  rejectCheck,
} from "../lib/editorial.js";

const ApproveBodySchema = z.object({
  notes: z.string().max(4000).optional(),
  publicSafetyReason: z.string().min(1).max(2000).optional(),
});
const RejectBodySchema = z.object({ notes: z.string().max(4000).optional() });
const CorrectBodySchema = z.object({ summary: z.string().min(1).max(4000), rating: RatingSchema, notes: z.string().max(4000).optional() });
const IssueRightOfReplyBodySchema = z.object({ namedPerson: z.string().min(1).max(500), contactChannel: z.string().min(1).max(200) });
const RecordRightOfReplyBodySchema = z.object({ replyText: z.string().max(10_000).nullable() });

/**
 * ADR-0025 §2 / ADR-0004 named-person gate: the editor review surface.
 * Every route is auth-guarded (`editor` or `admin`; `moderator` is
 * explicitly excluded — AT-0024-5 depends on that exclusion).
 */
export async function editorRoutes(app: FastifyInstance, deps: { db: Database; auth: AuthService }): Promise<void> {
  const { db, auth } = deps;
  const guard = requireRole(auth, ["editor", "admin"]);

  app.get("/v1/editor/queue", { preHandler: guard }, async (_request, reply) => {
    const queue = await getEditorQueue(db);
    return reply.status(200).send({ items: queue });
  });

  app.post<{ Params: { id: string } }>("/v1/editor/checks/:id/approve", { preHandler: guard }, async (request, reply) => {
    const parsed = ApproveBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const actor = request.authUser!;
    const result = await approveCheck(db, {
      actorId: actor.id,
      actorRole: actor.role,
      checkId: request.params.id,
      notes: parsed.data.notes ?? null,
      publicSafetyReason: parsed.data.publicSafetyReason ?? null,
    });
    if (!result.ok) {
      const status = result.error.kind === "not_found" ? 404 : result.error.kind === "forbidden" ? 403 : 422;
      return reply.status(status).send({ error: result.error.kind, message: result.error.message });
    }
    return reply.status(200).send(result.value);
  });

  app.post<{ Params: { id: string } }>("/v1/editor/checks/:id/reject", { preHandler: guard }, async (request, reply) => {
    const parsed = RejectBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const result = await rejectCheck(db, request.authUser!.id, request.params.id, parsed.data.notes ?? null);
    if (!result.ok) return reply.status(404).send({ error: result.error.kind, message: result.error.message });
    return reply.status(200).send(result.value);
  });

  app.post<{ Params: { id: string } }>("/v1/editor/checks/:id/correct", { preHandler: guard }, async (request, reply) => {
    const parsed = CorrectBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const result = await correctCheck(db, request.authUser!.id, request.params.id, {
      summary: parsed.data.summary,
      rating: parsed.data.rating,
      notes: parsed.data.notes ?? null,
    });
    if (!result.ok) {
      const status = result.error.kind === "not_found" ? 404 : 422;
      return reply.status(status).send({ error: result.error.kind, message: result.error.message });
    }
    return reply.status(201).send(result.value);
  });

  app.post<{ Params: { claimId: string } }>(
    "/v1/editor/claims/:claimId/confirm-attribution",
    { preHandler: guard },
    async (request, reply) => {
      const result = await confirmQuoteAttribution(db, request.authUser!.id, request.params.claimId);
      if (!result.ok) {
        const status = result.error.kind === "not_found" ? 404 : 422;
        return reply.status(status).send({ error: result.error.kind, message: result.error.message });
      }
      return reply.status(200).send(result.value);
    },
  );

  app.post<{ Params: { id: string } }>("/v1/editor/checks/:id/right-of-reply", { preHandler: guard }, async (request, reply) => {
    const parsed = IssueRightOfReplyBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    const result = await issueRightOfReply(db, request.authUser!.id, request.params.id, parsed.data);
    if (!result.ok) return reply.status(422).send({ error: result.error.kind, message: result.error.message });
    return reply.status(201).send(result.value);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/editor/right-of-reply/:id/record",
    { preHandler: guard },
    async (request, reply) => {
      const parsed = RecordRightOfReplyBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
      const result = await recordRightOfReply(db, request.authUser!.id, request.params.id, parsed.data);
      if (!result.ok) return reply.status(404).send({ error: result.error.kind, message: result.error.message });
      return reply.status(200).send(result.value);
    },
  );
}
