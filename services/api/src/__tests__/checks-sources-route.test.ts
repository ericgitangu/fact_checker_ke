import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { resolveConfig } from "../config.js";
import { InMemoryClaimSourceStore } from "../lib/claim-source.js";
import { FakePublisher } from "../lib/publisher.js";
import type { DeviceQuotaGuard } from "../lib/device-quota.js";

/** A fake resolver so the route never touches the real network in tests. */
const fakeFetch = (async (input: string | URL | Request) =>
  ({ ok: true, status: 200, url: String(input) }) as unknown as Response) as typeof fetch;

class AlwaysExceededQuota implements DeviceQuotaGuard {
  async checkAndConsume(): Promise<boolean> {
    return false;
  }
}

function seededStore(lifecycleState: "awaiting_sources" | "published" = "awaiting_sources"): {
  store: InMemoryClaimSourceStore;
  checkId: string;
} {
  const store = new InMemoryClaimSourceStore();
  const checkId = randomUUID();
  store.seedCheck(checkId, {
    lifecycleState,
    claimText: "A claim.",
    submissionId: randomUUID(),
    orgId: randomUUID(),
      language: "en",
  });
  return { store, checkId };
}

describe("POST /v1/checks/:id/sources (ADR-0038 Wave 2)", () => {
  it("404s when FEATURE_CROWDSOURCE_SOURCES is off (rollback path)", async () => {
    const { store, checkId } = seededStore();
    const app = await buildApp({
      logger: false,
      claimSourceStore: store,
      claimSourceFetchImpl: fakeFetch,
      config: resolveConfig({ FEATURE_CROWDSOURCE_SOURCES: "false" } as NodeJS.ProcessEnv),
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("400s without the X-Device-Token header", async () => {
    const { store, checkId } = seededStore();
    const app = await buildApp({ logger: false, claimSourceStore: store, claimSourceFetchImpl: fakeFetch });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("device_token_required");
    await app.close();
  });

  it("429s when the per-device daily quota is exceeded", async () => {
    const { store, checkId } = seededStore();
    const app = await buildApp({
      logger: false,
      claimSourceStore: store,
      claimSourceFetchImpl: fakeFetch,
      deviceQuotaGuard: new AlwaysExceededQuota(),
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it("400s on a non-URL body", async () => {
    const { store, checkId } = seededStore();
    const app = await buildApp({ logger: false, claimSourceStore: store, claimSourceFetchImpl: fakeFetch });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
    await app.close();
  });

  it("201 accepts an authoritative source and triggers a re-verify at the (default 1) threshold", async () => {
    const { store, checkId } = seededStore();
    const publisher = new FakePublisher();
    const app = await buildApp({
      logger: false,
      claimSourceStore: store,
      claimSourceFetchImpl: fakeFetch,
      publisher,
    });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/release", note: "official" },
    });
    expect(res.statusCode).toBe(201);
    // ADR-0038 hybrid threshold: TRIGGER=1, so a single accepted authoritative
    // (tier1 knbs.or.ke) source now enqueues a re-verify (was false at threshold 2).
    expect(res.json()).toEqual({ status: "accepted", reVerifyQueued: true });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    await app.close();
  });

  it("200 idempotent-duplicate on a repeat (check,url)", async () => {
    const { store, checkId } = seededStore();
    const app = await buildApp({ logger: false, claimSourceStore: store, claimSourceFetchImpl: fakeFetch });
    const once = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/release" },
    });
    expect(once.statusCode).toBe(201);
    const twice = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-2" },
      payload: { url: "https://knbs.or.ke/release" },
    });
    expect(twice.statusCode).toBe(200);
    expect(twice.json()).toEqual({ status: "duplicate", reVerifyQueued: false });
    await app.close();
  });

  it("409s when the check is not in an open thread (published)", async () => {
    const { store, checkId } = seededStore("published");
    const app = await buildApp({ logger: false, claimSourceStore: store, claimSourceFetchImpl: fakeFetch });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("lifecycle_closed");
    await app.close();
  });

  it("501s when no database/store is configured (in-memory mode)", async () => {
    const checkId = randomUUID();
    // No claimSourceStore option + no DATABASE_URL ⇒ null store ⇒ 501.
    const app = await buildApp({ logger: false, claimSourceFetchImpl: fakeFetch });
    const res = await app.inject({
      method: "POST",
      url: `/v1/checks/${checkId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(501);
    await app.close();
  });
});

describe("POST /v1/submissions/:id/sources (ADR-0038 Wave 2 trending)", () => {
  it("resolves the submission to its owning check and accepts an authoritative source", async () => {
    const store = new InMemoryClaimSourceStore();
    const checkId = randomUUID();
    const submissionId = randomUUID();
    store.seedCheck(checkId, {
      lifecycleState: "awaiting_sources",
      claimText: "A claim.",
      submissionId,
      orgId: randomUUID(),
      language: "en",
    });
    const app = await buildApp({ logger: false, claimSourceStore: store, claimSourceFetchImpl: fakeFetch });
    const res = await app.inject({
      method: "POST",
      url: `/v1/submissions/${submissionId}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(201);
    expect(["accepted", "rejected"]).toContain(res.json().status);
    // the source attached to the RESOLVED check, not leaking the draft id to the client
    expect(store.inserted.some((r) => r.checkId === checkId)).toBe(true);
    await app.close();
  });

  it("404s for a submission with no check", async () => {
    const store = new InMemoryClaimSourceStore();
    const app = await buildApp({ logger: false, claimSourceStore: store, claimSourceFetchImpl: fakeFetch });
    const res = await app.inject({
      method: "POST",
      url: `/v1/submissions/${randomUUID()}/sources`,
      headers: { "x-device-token": "tok-1" },
      payload: { url: "https://knbs.or.ke/x" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
