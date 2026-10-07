import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";

const allow: SignatureVerifier = { verify: async () => true };
const deny: SignatureVerifier = { verify: async () => false };

/**
 * ADR-0017 §4 (internal endpoints protected by QStash signature
 * verification). Tests the ROUTE's authorization behaviour against an
 * injected `SignatureVerifier` rather than reproducing QStash's JWT
 * format — see lib/internal-auth.ts's docblock for why; the real
 * `QStashSignatureVerifier` wraps `@upstash/qstash`'s own `Receiver`
 * unmodified, so there's nothing of our own to unit test there.
 */
describe("internal routes — signature verification", () => {
  it("rejects /internal/outbox/drain with no/invalid signature", async () => {
    const app = await buildApp({ logger: false, signatureVerifier: deny });
    const res = await app.inject({ method: "POST", url: "/internal/outbox/drain", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects /internal/events/submission-advanced with no/invalid signature", async () => {
    const app = await buildApp({ logger: false, signatureVerifier: deny });
    const res = await app.inject({ method: "POST", url: "/internal/events/submission-advanced", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("503s past signature verification when DB is unavailable (in-memory mode)", async () => {
    const app = await buildApp({ logger: false, signatureVerifier: allow });
    const res = await app.inject({ method: "POST", url: "/internal/outbox/drain", payload: {} });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("defaults to deny-all when no signing keys/verifier are configured (fail closed)", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: "POST", url: "/internal/outbox/drain", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects /internal/entitlements/sweep with no/invalid signature (fail closed)", async () => {
    const app = await buildApp({ logger: false, signatureVerifier: deny });
    const res = await app.inject({ method: "POST", url: "/internal/entitlements/sweep", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects /internal/checks/sweep-expired with no/invalid signature (fail closed)", async () => {
    const app = await buildApp({ logger: false, signatureVerifier: deny });
    const res = await app.inject({ method: "POST", url: "/internal/checks/sweep-expired", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("503s /internal/checks/sweep-expired past verification when DB is unavailable (in-memory mode)", async () => {
    // Like the drain route, the expiry sweep writes checks/submissions/
    // audit_log, so it needs a real DB — past signature verification it 503s
    // in in-memory mode rather than silently no-opping.
    const app = await buildApp({ logger: false, signatureVerifier: allow });
    const res = await app.inject({ method: "POST", url: "/internal/checks/sweep-expired", payload: {} });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("runs /internal/entitlements/sweep past verification via the (in-memory) repo — no DB 503", async () => {
    // Unlike the db-gated drain route, the sweep goes through the entitlement
    // REPOSITORY, so it works in in-memory mode and returns a count.
    const app = await buildApp({ logger: false, signatureVerifier: allow });
    const res = await app.inject({ method: "POST", url: "/internal/entitlements/sweep", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ expired: 0, pendingPruned: 0 });
    await app.close();
  });
});

describe("dev-only simulator route", () => {
  it("is registered outside production (NODE_ENV!=='production')", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev/simulate",
      payload: { submissionId: "not-a-uuid" },
    });
    // 400 (validation) or 503 (no db) — either way, NOT 404: the route exists.
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });

  it("is NOT registered when isProduction=true (404, not 503/400)", async () => {
    // buildApp({config}) bypasses resolveConfig()'s own production/
    // DATABASE_URL fail-fast entirely — it just wires routes off the
    // literal config object, which is exactly what this test needs: an
    // isProduction=true app without a real database, to prove the dev
    // simulator route itself is absent (not merely erroring).
    const app = await buildApp({
      logger: false,
      config: {
        databaseUrl: null,
        corsOrigins: ["http://localhost:3000"],
        upstashRedisRestUrl: null,
        upstashRedisRestToken: null,
        isProduction: true,
        qstashToken: null,
        analyzeHopUrl: "http://localhost:8000/internal/analyze",
        qstashCurrentSigningKey: null,
        qstashNextSigningKey: null,
        capabilityTokenSecret: "test-secret",
        redisTcpUrl: null,
      },
    });
    const res = await app.inject({ method: "POST", url: "/internal/dev/simulate", payload: {} });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
