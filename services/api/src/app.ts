import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { submissionRoutes } from "./routes/submissions.js";
import { checkRoutes } from "./routes/checks.js";
import { InMemoryCheckRepository, InMemorySubmissionRepository } from "./repositories/in-memory.js";
import type { CheckRepository, SubmissionRepository } from "./repositories/types.js";

export interface BuildAppOptions {
  submissions?: SubmissionRepository;
  checks?: CheckRepository;
  logger?: boolean;
}

/**
 * Builds a Fastify instance with routes wired to the given (or default
 * in-memory) repositories. Kept separate from server.ts so tests can build
 * the app with `fastify.inject()` without binding a real port.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const submissions = options.submissions ?? new InMemorySubmissionRepository();
  const checks = options.checks ?? new InMemoryCheckRepository();

  await app.register(healthRoutes);
  await app.register((instance) => submissionRoutes(instance, { submissions }));
  await app.register((instance) => checkRoutes(instance, { checks }));

  return app;
}
