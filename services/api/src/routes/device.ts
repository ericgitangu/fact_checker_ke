import type { FastifyInstance } from "fastify";
import type { DeviceTokenRepository } from "../repositories/types.js";
import type { RateLimiter } from "../rate-limit.js";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * ADR-0020 §1 (anonymous-token slice). No PII, no account: issues an
 * opaque device token that becomes the quota/stream-concurrency key
 * everywhere else (never the bare IP — closes C-9/CGNAT).
 */
export async function deviceRoutes(
  app: FastifyInstance,
  deps: { deviceTokens: DeviceTokenRepository; rateLimiter: RateLimiter },
): Promise<void> {
  app.post("/v1/device", async (request, reply) => {
    // COST-CONTROL (security audit G2, 2026-10-09): throttle token minting per
    // client IP so a script can't loop this to defeat the per-device submission
    // quota (and the downstream LLM spend it gates). Mirrors waitlist's IP key
    // resolution: trust the first x-forwarded-for hop (Vercel/Cloud Run proxy),
    // else the socket address.
    const forwardedFor = request.headers["x-forwarded-for"];
    const clientIp =
      (typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : undefined) ?? request.ip;
    const allowed = await deps.rateLimiter.check(clientIp);
    if (!allowed) {
      return reply
        .status(429)
        .send({ error: "rate_limited", message: "Too many device registrations. Try again shortly." });
    }

    const { token, createdAt } = await deps.deviceTokens.issue();
    const expiresAt = new Date(new Date(createdAt).getTime() + ONE_YEAR_MS).toISOString();

    reply.header("Cache-Control", "private, no-store");
    return reply.status(201).send({ token, expiresAt });
  });
}
