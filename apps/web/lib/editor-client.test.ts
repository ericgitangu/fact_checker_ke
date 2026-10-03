import { describe, it, expect, vi } from "vitest";
import { EditorClient, EditorClientError } from "./editor-client";

/**
 * These exercise the client-side seam's own request/parse logic (headers,
 * method, error mapping) against a mocked fetch — they do NOT exercise a
 * real services/api editor route, because none exists yet (see
 * editor-client.ts's header comment). That gap is called out explicitly
 * in the final report, not silently assumed covered.
 */
describe("EditorClient", () => {
  it("listDrafts GETs /v1/editor/drafts and returns the parsed body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ check: { id: "c1" } }]), { status: 200 }));
    const client = new EditorClient({ baseUrl: "http://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const drafts = await client.listDrafts();
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/v1/editor/drafts");
    expect(drafts).toHaveLength(1);
  });

  it("listDrafts throws EditorClientError on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const client = new EditorClient({ baseUrl: "http://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.listDrafts()).rejects.toBeInstanceOf(EditorClientError);
  });

  it("publish POSTs to /v1/editor/checks/:id/publish", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new EditorClient({ baseUrl: "http://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.publish("check-1");
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/v1/editor/checks/check-1/publish", { method: "POST" });
  });

  it("correct POSTs the rating/summary payload as JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new EditorClient({ baseUrl: "http://api.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.correct("check-1", { rating: "MostlyTrue", summary: "revised" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/v1/editor/checks/check-1/correct",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rating: "MostlyTrue", summary: "revised" }),
      }),
    );
  });
});
