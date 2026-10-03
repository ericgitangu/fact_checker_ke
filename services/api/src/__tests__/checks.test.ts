import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";

describe("GET /v1/checks/:id", () => {
  it("returns 404 for an unknown check id", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "GET",
      url: "/v1/checks/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
