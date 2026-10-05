import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Redis as UpstashRedis } from "@upstash/redis";
import { healthRoutes } from "./routes/health.js";
import { submissionRoutes } from "./routes/submissions.js";
import { checkRoutes } from "./routes/checks.js";
import { feedRoutes } from "./routes/feed.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import { deviceRoutes } from "./routes/device.js";
import { internalRoutes } from "./routes/internal.js";
import { sseRoutes } from "./routes/sse.js";
import { authRoutes } from "./routes/auth.js";
import { editorRoutes } from "./routes/editor.js";
import { funnelRoutes } from "./routes/funnel.js";
import { commentRoutes } from "./routes/comments.js";
import { maandamanoRoutes } from "./routes/maandamano.js";
import { entitlementRoutes } from "./routes/entitlement.js";
import { AuthService } from "./lib/auth/service.js";
import { EntitlementService } from "./lib/entitlement.js";
import { createBillingRegistry } from "./lib/billing/registry.js";
import {
  InMemoryCheckRepository,
  InMemoryDeviceTokenRepository,
  InMemoryEntitlementRepository,
  InMemorySubmissionRepository,
  InMemoryWaitlistRepository,
} from "./repositories/in-memory.js";
import { createPostgresRepositories } from "./repositories/postgres.js";
import type {
  CheckRepository,
  DeviceTokenRepository,
  EntitlementRepository,
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
  entitlements?: EntitlementRepository;
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
    // Cloud Run terminates TLS at the proxy and forwards HTTP to the
    // container, so request.protocol defaults to "http". QStash signs its
    // webhooks against the https:// destination URL (ADR-0017), so without
    // trusting the proxy the reconstructed URL is http:// and every QStash
    // signature verification 401s. trustProxy makes Fastify read
    // X-Forwarded-Proto / X-Forwarded-Host (set by Cloud Run's front end).
    trustProxy: true,
  });

  // Preserve the RAW JSON body. QStash's signature is a JWT whose body claim
  // is sha256(raw request bytes); verifying against a re-stringified copy of
  // the parsed body can mismatch, so keep the exact bytes on request.rawBody
  // (used by routes/internal.ts verifyOrReject — ADR-0017).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as unknown as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );

  const config = options.config ?? resolveConfig();
  const warn = (msg: string): void => app.log.warn(msg);

  let submissions = options.submissions;
  let checks = options.checks;
  let waitlist = options.waitlist;
  let deviceTokens = options.deviceTokens;
  let entitlements = options.entitlements;
  let db: Database | null = null;
  // Kept distinctly (not just as `submissions`) because
  // `InMemorySubmissionService` needs the concrete `.insert()` escape
  // hatch below — see its docblock in lib/submission-service.ts.
  let inMemorySubmissionsStore: InMemorySubmissionRepository | null = null;

  if (!submissions || !checks || !waitlist || !deviceTokens || !entitlements) {
    if (config.databaseUrl) {
      const pg = createPostgresRepositories(config.databaseUrl);
      submissions ??= pg.submissions;
      checks ??= pg.checks;
      waitlist ??= pg.waitlist;
      deviceTokens ??= pg.deviceTokens;
      entitlements ??= pg.entitlements;
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
      entitlements ??= new InMemoryEntitlementRepository();
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

  // ADR-0032/0017 "C1 gap" closer: the outbox relay now publishes every
  // outbox row (submission.received included) to THIS service's own
  // `/internal/hops/orchestrate` route — not straight to the pipeline
  // the way `config.analyzeHopUrl` still names (kept for back-compat/
  // documentation; see config.ts) — which is what actually drives a
  // submission.received event through /hops/analyze -> /hops/verify ->
  // enactPublishDecision. See routes/internal.ts + lib/
  // submission-orchestrator.ts.
  const orchestrationHopUrl = config.orchestrationHopUrl ?? `${config.apiSelfBaseUrl ?? "http://localhost:8080"}/internal/hops/orchestrate`;
  const pipelineBaseUrl = config.pipelineBaseUrl ?? "http://localhost:8000";

  const submissionService: SubmissionService =
    options.submissionService ??
    (db
      ? new PostgresSubmissionService(db, idempotencyPreCheck, publisher, orchestrationHopUrl, config.capabilityTokenSecret)
      : new InMemorySubmissionService(
          publisher,
          orchestrationHopUrl,
          inMemorySubmissionsStore ?? new InMemorySubmissionRepository(),
          config.capabilityTokenSecret,
        ));

  await app.register(cors, {
    origin: config.corsOrigins,
  });

  await app.register(healthRoutes);
  await app.register((instance) =>
    submissionRoutes(instance, { submissions: submissions!, submissionService, deviceQuotaGuard, checks: checks! }),
  );
  await app.register((instance) => checkRoutes(instance, { checks: checks!, db }));
  await app.register((instance) => feedRoutes(instance, { checks: checks! }));
  await app.register((instance) => waitlistRoutes(instance, { waitlist: waitlist!, rateLimiter }));
  await app.register((instance) => deviceRoutes(instance, { deviceTokens: deviceTokens! }));

  // ADR-0012 §3: entitlement read + billing (checkout/webhook). Registered
  // with either the Postgres or in-memory entitlement repo (same fallback
  // as the repos above), so the read path works in local dev; the billing
  // adapter is built from config and fails closed when PAYSTACK_SECRET_KEY
  // is unset (checkout → 503, webhook → 401), making the whole surface
  // inert until the owner adds a real key.
  const billing = createBillingRegistry({
    paystackSecretKey: config.paystackSecretKey ?? null,
    mpesa: config.mpesa,
    stripe: config.stripe,
  });
  const entitlementService = new EntitlementService(entitlements!);
  await app.register((instance) =>
    entitlementRoutes(instance, {
      entitlements: entitlements!,
      entitlementService,
      billing,
      webBaseUrl: config.webBaseUrl ?? null,
    }),
  );
  await app.register((instance) =>
    internalRoutes(instance, {
      db,
      publisher,
      pubsub,
      analyzeHopUrl: orchestrationHopUrl,
      pipelineBaseUrl,
      verifier: signatureVerifier,
      isProduction: config.isProduction,
      // ADR-0012 §3 (monetization v2): same entitlement repo the read/
      // webhook paths use, so the expiry sweeper (piggyback on
      // /internal/outbox/drain + the dedicated /internal/entitlements/sweep)
      // transitions lapsed active rows to `expired`.
      entitlements: entitlements!,
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

  // ADR-0020/0024/0025: editor/admin/moderator identity, editorial
  // review gate, and comment moderation all require a real Postgres
  // connection (users/audit_log/review_actions/comments tables) --
  // they're a no-op (routes not registered, 404 rather than a 500) when
  // running fully in-memory (local dev with no DATABASE_URL, or a unit
  // test that doesn't need them), same convention as the repositories
  // above falling back to in-memory doubles.
  if (db) {
    const authService = new AuthService(db);
    await app.register((instance) => authRoutes(instance, { auth: authService }));
    await app.register((instance) => editorRoutes(instance, { db, auth: authService }));
    await app.register((instance) => funnelRoutes(instance, { db, auth: authService }));
    await app.register((instance) => commentRoutes(instance, { db, auth: authService }));
    await app.register((instance) =>
      maandamanoRoutes(instance, {
        db,
        auth: authService,
        revalidate: { webBaseUrl: config.webBaseUrl ?? null, revalidateSecret: config.revalidateSecret ?? null },
        publisher,
        // ADR-0035: QStash target for the misinfo-triage job on attach.
        mediaTriageUrl: `${pipelineBaseUrl}/hops/media-triage`,
        pipelineCallbackSecret: config.pipelineCallbackSecret ?? null,
      }),
    );
  } else {
    warn("DATABASE_URL unset — auth/editor/comment/maandamano routes not registered (require Postgres).");
  }

  return app;
}
