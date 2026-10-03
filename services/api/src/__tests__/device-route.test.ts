import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("POST /v1/device (ADR-0020 anonymous-token slice)", () => {
  it("issues an opaque token with no PII and a no-store response", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: "POST", url: "/v1/device" });

    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toContain("no-store");
    const body = res.json() as { token: string; expiresAt: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThanOrEqual(32);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await app.close();
  });

  it("AT-0020-5: issues a distinct token on every call (rotation starts a fresh identity)", async () => {
    const app = await buildApp({ logger: false });
    const first = (await (await app.inject({ method: "POST", url: "/v1/device" })).json()) as { token: string };
    const second = (await (await app.inject({ method: "POST", url: "/v1/device" })).json()) as { token: string };
    expect(first.token).not.toBe(second.token);
    await app.close();
  });
});
