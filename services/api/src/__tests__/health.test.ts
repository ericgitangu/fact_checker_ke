import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
