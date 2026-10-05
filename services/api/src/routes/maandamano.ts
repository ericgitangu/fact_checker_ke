import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "@fact-checker-ke/db";
import { DemonstrationMediaPlatformSchema, DemonstrationStatusSchema, isPlatformEmbedHost } from "@fact-checker-ke/core";
import type { AuthService } from "../lib/auth/service.js";
import { requireRole } from "../lib/auth/middleware.js";
import {
  attachDemonstrationMedia,
  applyMediaMisinfoResult,
  getMaandamanoAdvisories,
  getMaandamanoArchive,
  recordDemonstrationStatus,
  setMaandamanoKillSwitch,
} from "../lib/maandamano.js";
import { triggerMaandamanoRevalidation, type MaandamanoRevalidateConfig } from "../lib/maandamano-revalidate.js";
import type { Publisher } from "../lib/publisher.js";
import { NO_STORE_CACHE_CONTROL } from "../lib/cache-headers.js";

const KillSwitchBodySchema = z.object({ enabled: z.boolean() });

/**
 * ADR-0035 (AT-0035-2): attaching an embed stores only a POINTER
 * ({platform, embedUrl, caption, observedAt}) on a host-allowlisted embed
 * host — never media bytes. `embedUrl`'s host is validated against the
 * platform allowlist here (`isPlatformEmbedHost`), which is what rejects a
 * re-hosted/arbitrary URL. There is no bytes/file field to accept.
 */
const AttachMediaBodySchema = z.object({
  platform: DemonstrationMediaPlatformSchema,
  embedUrl: z
    .string()
    .url()
    .refine(isPlatformEmbedHost, { message: "embedUrl host must be a platform embed/oEmbed host (ADR-0035)" }),
  caption: z.string().max(280).nullable().optional(),
  observedAt: z.string().datetime().optional(),
});

const StatusChangeBodySchema = z.object({
  status: DemonstrationStatusSchema,
  note: z.string().max(500).nullable().optional(),
});

/**
 * ADR-0035 pipeline → API write-back (step 6). The embed's reverse-image/
 * synthetic-media check result. `status` is only ever the terminal
 * `clear`/`flagged` (never `unchecked`/`checking`, which are set API-side).
 */
const MisinfoCallbackBodySchema = z.object({
  status: z.enum(["clear", "flagged"]),
  note: z.string().max(500).nullable().optional(),
  earlierUrl: z.string().url().nullable().optional(),
});

export interface MaandamanoRoutesDeps {
  db: Database;
  auth: AuthService;
  revalidate: MaandamanoRevalidateConfig;
  /** ADR-0035: used to enqueue the misinfo-triage job on attach. */
  publisher: Publisher;
  /** ADR-0035: QStash target — services/pipeline's media-triage hop. */
  mediaTriageUrl: string;
  /**
   * ADR-0035: shared secret that gates the pipeline → API misinfo
   * callback. Fail-closed: when unset, the callback route rejects every
   * request (same "no configured verifier ⇒ reject" posture as
   * DenyAllSignatureVerifier for the QStash-gated internal routes).
   */
  pipelineCallbackSecret: string | null;
}

function secretMatches(provided: string | undefined, expected: string | null): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A) + ADR-0035 (live media
 * embeds, misinfo-checked, archive).
 *
 * `GET /v1/maandamano` (unchanged contract) and `GET /v1/maandamano/
 * archive` are the two public read paths, both `private, no-store` and
 * both kill-switch-gated through the same server-side frozen check
 * (lib/maandamano.ts) so a reader cannot retrieve live/archived rows
 * while the switch is on.
 */
export async function maandamanoRoutes(app: FastifyInstance, deps: MaandamanoRoutesDeps): Promise<void> {
  const { db, auth, revalidate, publisher, mediaTriageUrl, pipelineCallbackSecret } = deps;
  const adminGuard = requireRole(auth, ["admin"]);
  // ADR-0035 (AT-0035-6): attaching an embed / advancing a status is only
  // ever an authenticated editor/admin action — never the fetch engine.
  const curationGuard = requireRole(auth, ["admin", "editor"]);

  app.get("/v1/maandamano", async (_request, reply) => {
    const data = await getMaandamanoAdvisories(db);
    reply.header("cache-control", NO_STORE_CACHE_CONTROL);
    return reply.status(200).send(data);
  });

  // ADR-0035 (AT-0035-5): the archive read model — ended/cancelled
  // advisories + status history + source/embed links, never raw media.
  app.get("/v1/maandamano/archive", async (_request, reply) => {
    const data = await getMaandamanoArchive(db);
    reply.header("cache-control", NO_STORE_CACHE_CONTROL);
    return reply.status(200).send(data);
  });

  app.post("/v1/admin/maandamano/kill-switch", { preHandler: adminGuard }, async (request, reply) => {
    const parsed = KillSwitchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const actor = request.authUser!;

    const result = await setMaandamanoKillSwitch(db, { actorId: actor.id, enabled: parsed.data.enabled });
    if (!result.ok) {
      return reply.status(400).send({ error: result.error.kind, message: result.error.message });
    }

    const revalidated = await triggerMaandamanoRevalidation(revalidate, (msg) => app.log.warn(msg));

    return reply.status(200).send({ ...result.value, revalidated });
  });

  // ADR-0035 (AT-0035-2/3/6): attach an iframe embed to an advisory —
  // admin/editor only, host-allowlisted, routed through the misinfo check.
  app.post<{ Params: { id: string } }>(
    "/v1/admin/maandamano/:id/media",
    { preHandler: curationGuard },
    async (request, reply) => {
      const parsed = AttachMediaBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const actor = request.authUser!;
      const result = await attachDemonstrationMedia(db, {
        actorId: actor.id,
        demonstrationId: request.params.id,
        platform: parsed.data.platform,
        embedUrl: parsed.data.embedUrl,
        caption: parsed.data.caption ?? null,
        observedAt: parsed.data.observedAt ?? new Date().toISOString(),
        enqueueTriage: { publisher, mediaTriageUrl },
      });
      if (!result.ok) {
        const status = result.error.kind === "not_found" ? 404 : 400;
        return reply.status(status).send({ error: result.error.kind, message: result.error.message });
      }
      await triggerMaandamanoRevalidation(revalidate, (msg) => app.log.warn(msg));
      return reply.status(201).send(result.value);
    },
  );

  // ADR-0035 (AT-0035-7): change a demonstration status; appends a
  // status-history row in the same transaction. Admin/editor only.
  app.post<{ Params: { id: string } }>(
    "/v1/admin/maandamano/:id/status",
    { preHandler: curationGuard },
    async (request, reply) => {
      const parsed = StatusChangeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const actor = request.authUser!;
      const result = await recordDemonstrationStatus(db, {
        actorId: actor.id,
        demonstrationId: request.params.id,
        status: parsed.data.status,
        note: parsed.data.note ?? null,
      });
      if (!result.ok) {
        const status = result.error.kind === "not_found" ? 404 : 400;
        return reply.status(status).send({ error: result.error.kind, message: result.error.message });
      }
      await triggerMaandamanoRevalidation(revalidate, (msg) => app.log.warn(msg));
      return reply.status(200).send(result.value);
    },
  );

  // ADR-0035 step 6: secret-gated pipeline → API misinfo write-back.
  app.post<{ Params: { mediaId: string } }>(
    "/v1/internal/maandamano/media/:mediaId/misinfo",
    async (request: FastifyRequest<{ Params: { mediaId: string } }>, reply: FastifyReply) => {
      const header = request.headers["x-internal-secret"];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!secretMatches(provided, pipelineCallbackSecret)) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      const parsed = MisinfoCallbackBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const result = await applyMediaMisinfoResult(db, {
        mediaId: request.params.mediaId,
        status: parsed.data.status,
        note: parsed.data.note ?? null,
        earlierUrl: parsed.data.earlierUrl ?? null,
      });
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.kind, message: result.error.message });
      }
      await triggerMaandamanoRevalidation(revalidate, (msg) => app.log.warn(msg));
      return reply.status(200).send(result.value);
    },
  );
}
