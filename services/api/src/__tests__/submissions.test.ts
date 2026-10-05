import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryCheckRepository } from "../repositories/in-memory.js";

const DEVICE_TOKEN = "test-device-token";

async function createSubmission(app: Awaited<ReturnType<typeof buildApp>>, text: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/submissions",
    headers: { "idempotency-key": randomUUID(), "x-device-token": DEVICE_TOKEN },
    payload: { text },
  });
  return (created.json() as { id: string }).id;
}

function seedCheck(
  checks: InMemoryCheckRepository,
  args: { id: string; submissionId: string; published: boolean },
): void {
  checks.seed({
    id: args.id,
    submissionId: args.submissionId,
    summary: "s",
    rating: args.published ? "False" : null,
    claims: [],
    sources: [],
    isDraft: !args.published,
    reviewedBy: null,
    createdAt: new Date().toISOString(),
    publishedAt: args.published ? new Date().toISOString() : null,
    calibratedConfidence: null,
    whatWouldChangeThis: null,
    context: args.published ? "The claim restates a figure the cited source corrects." : null,
    evidence: [],
    riskTier: null,
  });
}

describe("POST /v1/submissions", () => {
  it("rejects a request with no X-Device-Token header (ADR-0020)", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID() },
      payload: { url: "https://example.com/clip" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "device_token_required" });
    await app.close();
  });

  it("rejects a request with no Idempotency-Key header", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { url: "https://example.com/clip" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "idempotency_key_required" });
    await app.close();
  });

  it("accepts a valid url submission and returns 202 with an id and an eventsToken", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": DEVICE_TOKEN },
      payload: { url: "https://example.com/clip" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; eventsToken: string };
    expect(typeof body.id).toBe("string");
    expect(typeof body.eventsToken).toBe("string");
    await app.close();
  });

  it("rejects a submission with neither url nor text", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": DEVICE_TOKEN },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/submissions/:id", () => {
  it("returns the submission created via POST", async () => {
    const app = await buildApp({ logger: false });
    const created = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: { "idempotency-key": randomUUID(), "x-device-token": DEVICE_TOKEN },
      payload: { text: "a claim to check" },
    });
    const { id } = created.json() as { id: string };

    const res = await app.inject({ method: "GET", url: `/v1/submissions/${id}` });
    expect(res.statusCode).toBe(200);
    // Additive contract (checkId pointer): no check exists yet for a
    // just-received submission.
    expect(res.json()).toMatchObject({
      id,
      text: "a claim to check",
      status: "received",
      checkId: null,
      checkPublished: false,
    });
    await app.close();
  });

  it("carries the REAL checkId (distinct from submissionId) with checkPublished=true for a published result", async () => {
    const checks = new InMemoryCheckRepository();
    const app = await buildApp({ logger: false, checks });
    const id = await createSubmission(app, "a claim with a published result");
    const checkId = randomUUID();
    seedCheck(checks, { id: checkId, submissionId: id, published: true });

    const res = await app.inject({ method: "GET", url: `/v1/submissions/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { checkId: string | null; checkPublished: boolean };
    expect(body.checkId).toBe(checkId);
    expect(body.checkId).not.toBe(id); // the former bug: it linked /checks/{submissionId}
    expect(body.checkPublished).toBe(true);
    await app.close();
  });

  it("carries the checkId with checkPublished=false for a held draft (ready but not public)", async () => {
    const checks = new InMemoryCheckRepository();
    const app = await buildApp({ logger: false, checks });
    const id = await createSubmission(app, "a claim held for editor review");
    const checkId = randomUUID();
    seedCheck(checks, { id: checkId, submissionId: id, published: false });

    const res = await app.inject({ method: "GET", url: `/v1/submissions/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { checkId: string | null; checkPublished: boolean };
    expect(body.checkId).toBe(checkId);
    expect(body.checkPublished).toBe(false);
    await app.close();
  });

  it("returns 404 for an unknown submission id", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/v1/submissions/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
