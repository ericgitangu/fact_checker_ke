import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@fact-checker-ke/db";
import type { AuthService } from "../lib/auth/service.js";
import { requireRole } from "../lib/auth/middleware.js";
import { getMaandamanoAdvisories, setMaandamanoKillSwitch } from "../lib/maandamano.js";
import { triggerMaandamanoRevalidation, type MaandamanoRevalidateConfig } from "../lib/maandamano-revalidate.js";
import { NO_STORE_CACHE_CONTROL } from "../lib/cache-headers.js";

const KillSwitchBodySchema = z.object({ enabled: z.boolean() });

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A) /
 * docs/runbooks/nc4-kill-switch.md.
 *
 * `GET /v1/maandamano` is the public read path. It is intentionally
 * `private, no-store` at the HTTP layer (never cached by the API
 * itself) -- freshness here does not depend on anyone purging anything,
 * because there is nothing to purge: every request re-reads the
 * `maandamano_kill_switch` policy flag from Postgres
 * (lib/maandamano.ts#getMaandamanoAdvisories). apps/web's own ISR cache
 * of the RENDERED page is a separate layer purged via the revalidation
 * webhook below -- this route is what that rendered page's data
 * ultimately comes from.
 *
 * `POST /v1/admin/maandamano/kill-switch` is the admin-only flip
 * (runbook Step 2). Admin-only matches the runbook ("Only the admin
 * role can execute this") and ADR-0020 §4's existing admin-gated
 * pattern (see routes/funnel.ts).
 */
export async function maandamanoRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthService; revalidate: MaandamanoRevalidateConfig },
): Promise<void> {
  const { db, auth, revalidate } = deps;
  const guard = requireRole(auth, ["admin"]);

  app.get("/v1/maandamano", async (_request, reply) => {
    const data = await getMaandamanoAdvisories(db);
    reply.header("cache-control", NO_STORE_CACHE_CONTROL);
    return reply.status(200).send(data);
  });

  app.post("/v1/admin/maandamano/kill-switch", { preHandler: guard }, async (request, reply) => {
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
}
