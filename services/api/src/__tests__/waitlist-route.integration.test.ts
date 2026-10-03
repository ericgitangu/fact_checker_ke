import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { requireIntegrationDatabaseUrl } from "./integration-env.js";

const connectionString = requireIntegrationDatabaseUrl();

/**
 * End-to-end through the Fastify route (not just the repository) against
 * a real Postgres, proving the full request -> validation -> repo ->
 * unique-constraint-on-conflict path works, not just the repo in
 * isolation (postgres-repositories.integration.test.ts).
 */
describe.skipIf(!connectionString)("POST /v1/waitlist (integration, Postgres)", () => {
  it("201 joined, then 200 already_joined for the same email", async () => {
    const app = await buildApp({
      logger: false,
      config: {
        databaseUrl: connectionString as string,
        corsOrigins: ["http://localhost:5173"],
        upstashRedisRestUrl: null,
        upstashRedisRestToken: null,
        isProduction: false,
        qstashToken: null,
        analyzeHopUrl: "http://localhost:8000/internal/analyze",
        qstashCurrentSigningKey: null,
        qstashNextSigningKey: null,
        capabilityTokenSecret: "test-capability-secret",
        redisTcpUrl: null,
      },
      rateLimiter: { check: async () => true },
    });

    const email = `route-${randomUUID()}@example.com`;

    const first = await app.inject({ method: "POST", url: "/v1/waitlist", payload: { email } });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: "POST", url: "/v1/waitlist", payload: { email } });
    expect(second.statusCode).toBe(200);

    await app.close();
  });
});
