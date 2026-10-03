import type { FastifyInstance } from "fastify";
import { WaitlistSignupInputSchema } from "@fact-checker-ke/core";
import type { WaitlistRepository } from "../repositories/types.js";
import type { RateLimiter } from "../rate-limit.js";

export async function waitlistRoutes(
  app: FastifyInstance,
  deps: { waitlist: WaitlistRepository; rateLimiter: RateLimiter },
): Promise<void> {
  app.post("/v1/waitlist", async (request, reply) => {
    // x-forwarded-for can carry a comma-separated chain behind a proxy;
    // the first entry is the original client. Falls back to the raw
    // socket address for direct/local connections (tests, dev).
    const forwardedFor = request.headers["x-forwarded-for"];
    const clientIp =
      (typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : undefined) ??
      request.ip;

    const allowed = await deps.rateLimiter.check(clientIp);
    if (!allowed) {
      return reply.status(429).send({ error: "rate_limited", message: "Too many requests. Try again shortly." });
    }

    const parseResult = WaitlistSignupInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "validation_error",
        issues: parseResult.error.issues,
      });
    }

    const result = await deps.waitlist.join(parseResult.data);
    if (!result.ok) {
      return reply.status(500).send({ error: "internal", message: result.error.message });
    }

    const statusCode = result.value.status === "joined" ? 201 : 200;
    return reply.status(statusCode).send(result.value);
  });
}
