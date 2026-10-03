import type { FastifyInstance } from "fastify";
import type { DeviceTokenRepository } from "../repositories/types.js";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * ADR-0020 §1 (anonymous-token slice). No PII, no account: issues an
 * opaque device token that becomes the quota/stream-concurrency key
 * everywhere else (never the bare IP — closes C-9/CGNAT).
 */
export async function deviceRoutes(
  app: FastifyInstance,
  deps: { deviceTokens: DeviceTokenRepository },
): Promise<void> {
  app.post("/v1/device", async (_request, reply) => {
    const { token, createdAt } = await deps.deviceTokens.issue();
    const expiresAt = new Date(new Date(createdAt).getTime() + ONE_YEAR_MS).toISOString();

    reply.header("Cache-Control", "private, no-store");
    return reply.status(201).send({ token, expiresAt });
  });
}
