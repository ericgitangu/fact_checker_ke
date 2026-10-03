import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";

const DEVICE_TOKEN = "test-device-token";

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
    expect(res.json()).toMatchObject({ id, text: "a claim to check", status: "received" });
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
