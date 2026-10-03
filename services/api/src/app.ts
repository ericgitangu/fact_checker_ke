import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Redis as UpstashRedis } from "@upstash/redis";
import { healthRoutes } from "./routes/health.js";
import { submissionRoutes } from "./routes/submissions.js";
import { checkRoutes } from "./routes/checks.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import { deviceRoutes } from "./routes/device.js";
import { internalRoutes } from "./routes/internal.js";
import { sseRoutes } from "./routes/sse.js";
import {
  InMemoryCheckRepository,
  InMemoryDeviceTokenRepository,
  InMemorySubmissionRepository,
  InMemoryWaitlistRepository,
} from "./repositories/in-memory.js";
import { createPostgresRepositories } from "./repositories/postgres.js";
import type {
  CheckRepository,
  DeviceTokenRepository,
  SubmissionRepository,
  WaitlistRepository,
} from "./repositories/types.js";
import { createWaitlistRateLimiter, type RateLimiter } from "./rate-limit.js";
import { resolveConfig, type ResolvedConfig } from "./config.js";
import { FakePublisher, QStashPublisher, type Publisher } from "./lib/publisher.js";
import { createPubSub, type PubSub } from "./lib/pubsub.js";
import {
  NoopIdempotencyPreCheck,
  RedisIdempotencyPreCheck,
  type IdempotencyPreCheck,
} from "./lib/idempotency.js";
import {
  InMemoryConcurrencyGuard,
  RedisConcurrencyGuard,
  type ConcurrencyGuard,
} from "./lib/concurrency-guard.js";
import {
  InMemoryDeviceQuotaGuard,
  RedisDeviceQuotaGuard,
  type DeviceQuotaGuard,
} from "./lib/device-quota.js";
import {
  DenyAllSignatureVerifier,
  QStashSignatureVerifier,
  type SignatureVerifier,
} from "./lib/internal-auth.js";
import {
  InMemorySubmissionService,
  PostgresSubmissionService,
  type SubmissionService,
} from "./lib/submission-service.js";
import type { Database } from "@fact-checker-ke/db";

export interface BuildAppOptions {
  submissions?: SubmissionRepository;
  checks?: CheckRepository;
  waitlist?: WaitlistRepository;
  deviceTokens?: DeviceTokenRepository;
  submissionService?: SubmissionService;
  rateLimiter?: RateLimiter;
  publisher?: Publisher;
  pubsub?: PubSub;
  signatureVerifier?: SignatureVerifier;
  idempotencyPreCheck?: IdempotencyPreCheck;
  deviceConcurrencyGuard?: ConcurrencyGuard;
  ipConcurrencyGuard?: ConcurrencyGuard;
  deviceQuotaGuard?: DeviceQuotaGuard;
  /** SSE tuning knobs (tests override these to avoid 15s/90s real waits). */
  sseHeartbeatMs?: number;
  sseMaxDurationMs?: number;
  logger?: boolean;
  config?: ResolvedConfig;
}

/**
 * Builds a Fastify instance with routes wired to the given (or
 * env-resolved) repositories. Kept separate from server.ts so tests can
 * build the app with `fastify.inject()` without binding a real port, and
 * so tests can inject in-memory/fake doubles without touching env vars.
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
  const warn = (msg: string): void => app.log.warn(msg);

  let submissions = options.submissions;
  let checks = options.checks;
  let waitlist = options.waitlist;
  let deviceTokens = options.deviceTokens;
  let db: Database | null = null;
  // Kept distinctly (not just as `submissions`) because
  // `InMemorySubmissionService` needs the concrete `.insert()` escape
  // hatch below — see its docblock in lib/submission-service.ts.
  let inMemorySubmissionsStore: InMemorySubmissionRepository | null = null;

  if (!submissions || !checks || !waitlist || !deviceTokens) {
    if (config.databaseUrl) {
      const pg = createPostgresRepositories(config.databaseUrl);
      submissions ??= pg.submissions;
      checks ??= pg.checks;
      waitlist ??= pg.waitlist;
      deviceTokens ??= pg.deviceTokens;
      db = pg.db;
      app.addHook("onClose", async () => {
        await pg.close();
      });
    } else {
      warn("DATABASE_URL unset — using in-memory repositories (NOT durable, test/dev only).");
      if (!submissions) {
        inMemorySubmissionsStore = new InMemorySubmissionRepository();
        submissions = inMemorySubmissionsStore;
      }
      checks ??= new InMemoryCheckRepository();
      waitlist ??= new InMemoryWaitlistRepository();
      deviceTokens ??= new InMemoryDeviceTokenRepository();
    }
  }

  const rateLimiter = options.rateLimiter ?? createWaitlistRateLimiter(config, warn);

  const publisher: Publisher =
    options.publisher ?? (config.qstashToken ? new QStashPublisher(config.qstashToken) : new FakePublisher());

  const pubsub: PubSub = options.pubsub ?? (await createPubSub(config.redisTcpUrl, warn));
  app.addHook("onClose", async () => {
    await pubsub.close();
  });

  const signatureVerifier: SignatureVerifier =
    options.signatureVerifier ??
    (config.qstashCurrentSigningKey && config.qstashNextSigningKey
      ? new QStashSignatureVerifier(config.qstashCurrentSigningKey, config.qstashNextSigningKey)
      : new DenyAllSignatureVerifier());

  const upstashRest =
    config.upstashRedisRestUrl && config.upstashRedisRestToken
      ? new UpstashRedis({ url: config.upstashRedisRestUrl, token: config.upstashRedisRestToken })
      : null;

  const idempotencyPreCheck: IdempotencyPreCheck =
    options.idempotencyPreCheck ?? (upstashRest ? new RedisIdempotencyPreCheck(upstashRest) : new NoopIdempotencyPreCheck());

  // ADR-0018 §5 / red-team C-9: 2 per device, 50 (coarse) per IP.
  const deviceConcurrencyGuard: ConcurrencyGuard =
    options.deviceConcurrencyGuard ?? (upstashRest ? new RedisConcurrencyGuard(upstashRest, 2) : new InMemoryConcurrencyGuard(2));
  const ipConcurrencyGuard: ConcurrencyGuard =
    options.ipConcurrencyGuard ?? (upstashRest ? new RedisConcurrencyGuard(upstashRest, 50) : new InMemoryConcurrencyGuard(50));

  const deviceQuotaGuard: DeviceQuotaGuard =
    options.deviceQuotaGuard ?? (upstashRest ? new RedisDeviceQuotaGuard(upstashRest) : new InMemoryDeviceQuotaGuard());

  const submissionService: SubmissionService =
    options.submissionService ??
    (db
      ? new PostgresSubmissionService(db, idempotencyPreCheck, publisher, config.analyzeHopUrl, config.capabilityTokenSecret)
      : new InMemorySubmissionService(
          publisher,
          config.analyzeHopUrl,
          inMemorySubmissionsStore ?? new InMemorySubmissionRepository(),
          config.capabilityTokenSecret,
        ));

  await app.register(cors, {
    origin: config.corsOrigins,
  });

  await app.register(healthRoutes);
  await app.register((instance) =>
    submissionRoutes(instance, { submissions: submissions!, submissionService, deviceQuotaGuard }),
  );
  await app.register((instance) => checkRoutes(instance, { checks: checks! }));
  await app.register((instance) => waitlistRoutes(instance, { waitlist: waitlist!, rateLimiter }));
  await app.register((instance) => deviceRoutes(instance, { deviceTokens: deviceTokens! }));
  await app.register((instance) =>
    internalRoutes(instance, {
      db,
      publisher,
      pubsub,
      analyzeHopUrl: config.analyzeHopUrl,
      verifier: signatureVerifier,
      isProduction: config.isProduction,
    }),
  );
  await app.register((instance) =>
    sseRoutes(instance, {
      db,
      pubsub,
      capabilityTokenSecret: config.capabilityTokenSecret,
      deviceGuard: deviceConcurrencyGuard,
      ipGuard: ipConcurrencyGuard,
      heartbeatMs: options.sseHeartbeatMs,
      maxDurationMs: options.sseMaxDurationMs,
    }),
  );

  return app;
}
