import type { FastifyInstance } from "fastify";
import { SubmissionInputSchema } from "@fact-checker-ke/core";
import type { SubmissionRepository } from "../repositories/types.js";

export async function submissionRoutes(
  app: FastifyInstance,
  deps: { submissions: SubmissionRepository },
): Promise<void> {
  app.post("/v1/submissions", async (request, reply) => {
    const parseResult = SubmissionInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "validation_error",
        issues: parseResult.error.issues,
      });
    }

    const input = parseResult.data;
    const submission = await deps.submissions.create({
      url: input.url ?? null,
      text: input.text ?? null,
      submittedBy: input.submittedBy ?? null,
    });

    return reply.status(202).send({ id: submission.id });
  });
}
