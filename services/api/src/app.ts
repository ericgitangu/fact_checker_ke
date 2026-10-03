import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { healthRoutes } from "./routes/health.js";
import { submissionRoutes } from "./routes/submissions.js";
import { checkRoutes } from "./routes/checks.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import {
  InMemoryCheckRepository,
  InMemorySubmissionRepository,
  InMemoryWaitlistRepository,
} from "./repositories/in-memory.js";
import { createPostgresRepositories } from "./repositories/postgres.js";
import type { CheckRepository, SubmissionRepository, WaitlistRepository } from "./repositories/types.js";
import { createWaitlistRateLimiter, type RateLimiter } from "./rate-limit.js";
import { resolveConfig, type ResolvedConfig } from "./config.js";

export interface BuildAppOptions {
  submissions?: SubmissionRepository;
  checks?: CheckRepository;
  waitlist?: WaitlistRepository;
  rateLimiter?: RateLimiter;
  logger?: boolean;
  config?: ResolvedConfig;
}

/**
 * Builds a Fastify instance with routes wired to the given (or
 * env-resolved) repositories. Kept separate from server.ts so tests can
 * build the app with `fastify.inject()` without binding a real port, and
 * so tests can inject in-memory doubles without touching env vars.
 *
 * Repository selection (when not overridden by `options`):
 *   - config.databaseUrl set   -> Postgres-backed repositories.
 *   - config.databaseUrl unset -> in-memory doubles, with a warn log
 *     (resolveConfig() already refuses to reach here with no
 *     DATABASE_URL in production).
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
  });

  const config = options.config ?? resolveConfig();

  let submissions = options.submissions;
  let checks = options.checks;
  let waitlist = options.waitlist;

  if (!submissions || !checks || !waitlist) {
    if (config.databaseUrl) {
      const pg = createPostgresRepositories(config.databaseUrl);
      submissions ??= pg.submissions;
      checks ??= pg.checks;
      waitlist ??= pg.waitlist;
      app.addHook("onClose", async () => {
        await pg.close();
      });
    } else {
      app.log.warn(
        "DATABASE_URL unset — using in-memory repositories (NOT durable, test/dev only).",
      );
      submissions ??= new InMemorySubmissionRepository();
      checks ??= new InMemoryCheckRepository();
      waitlist ??= new InMemoryWaitlistRepository();
    }
  }

  const rateLimiter =
    options.rateLimiter ??
    createWaitlistRateLimiter(config, (msg) => app.log.warn(msg));

  await app.register(cors, {
    origin: config.corsOrigins,
  });

  await app.register(healthRoutes);
  await app.register((instance) => submissionRoutes(instance, { submissions: submissions! }));
  await app.register((instance) => checkRoutes(instance, { checks: checks! }));
  await app.register((instance) => waitlistRoutes(instance, { waitlist: waitlist!, rateLimiter }));

  return app;
}
