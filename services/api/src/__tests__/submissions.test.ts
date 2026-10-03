import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";

describe("POST /v1/submissions", () => {
  it("accepts a valid url submission and returns 202 with an id", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: { url: "https://example.com/clip" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string };
    expect(typeof body.id).toBe("string");
    await app.close();
  });

  it("rejects a submission with neither url nor text", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/submissions",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
