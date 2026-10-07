import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // `/health` (NOT `/healthz`): any `*z` path on a *.run.app URL is intercepted
  // by Cloud Run's frontend and returns a branded 404 with no request logs,
  // never reaching the container — so `/healthz` was unreachable in prod. See
  // reference-cloudrun-gotchas. DB-free by construction (ADR-0016 Neon wake
  // budget: health must not touch the DB).
  app.get("/health", async () => {
    return { status: "ok" as const };
  });
}
