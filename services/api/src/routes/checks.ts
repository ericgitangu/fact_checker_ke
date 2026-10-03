import type { FastifyInstance } from "fastify";
import type { CheckRepository } from "../repositories/types.js";

export async function checkRoutes(
  app: FastifyInstance,
  deps: { checks: CheckRepository },
): Promise<void> {
  app.get<{ Params: { id: string } }>("/v1/checks/:id", async (request, reply) => {
    const result = await deps.checks.getById(request.params.id);
    if (!result.ok) {
      return reply.status(404).send({ error: "not_found", message: result.error.message });
    }
    return reply.status(200).send(result.value);
  });
}
