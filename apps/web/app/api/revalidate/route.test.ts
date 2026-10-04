import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { revalidateTag } = await import("next/cache");
const { POST } = await import("./route");

const ORIGINAL_SECRET = process.env.REVALIDATE_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.REVALIDATE_SECRET;
  else process.env.REVALIDATE_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
});

/**
 * ADR-0007 kill-switch mechanism — the "fast propagation" webhook
 * (docs/runbooks/nc4-kill-switch.md Step 2.2). Exercises the REAL route
 * handler (app/api/revalidate/route.ts), not a replica of its logic.
 */
describe("POST /api/revalidate (ADR-0007 kill-switch propagation webhook)", () => {
  it("returns 503 when REVALIDATE_SECRET is not configured", async () => {
    delete process.env.REVALIDATE_SECRET;

    const res = await POST(
      new Request("http://localhost/api/revalidate?tag=maandamano&secret=anything", { method: "POST" }),
    );

    expect(res.status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret with 401 and does NOT revalidate", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";

    const res = await POST(
      new Request("http://localhost/api/revalidate?tag=maandamano&secret=wrong-secret", { method: "POST" }),
    );

    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a missing tag with 400", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";

    const res = await POST(new Request("http://localhost/api/revalidate?secret=correct-secret", { method: "POST" }));

    expect(res.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates the 'maandamano' tag given the correct secret", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";

    const res = await POST(
      new Request("http://localhost/api/revalidate?tag=maandamano&secret=correct-secret", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ revalidated: true, tag: "maandamano" });
    // `{ expire: 0 }`: this webhook runs outside a Server Action, so
    // `updateTag` isn't available (Next 16 restricts it to Server
    // Actions) -- see the route's own comment for why this, not
    // `profile: "max"`, is the correct call for a kill-switch flip.
    expect(revalidateTag).toHaveBeenCalledWith("maandamano", { expire: 0 });
  });
});
