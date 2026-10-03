import { describe, expect, it } from "vitest";
import { InMemoryConcurrencyGuard } from "../lib/concurrency-guard.js";

describe("InMemoryConcurrencyGuard (ADR-0018 §5 / red-team C-9)", () => {
  it("allows up to the limit, then rejects", async () => {
    const guard = new InMemoryConcurrencyGuard(2);
    expect(await guard.acquire("device-a")).toBe(true);
    expect(await guard.acquire("device-a")).toBe(true);
    expect(await guard.acquire("device-a")).toBe(false);
  });

  it("AT-0018-8/AT-0020-1: two different device keys never share a limit (CGNAT-safe)", async () => {
    const guard = new InMemoryConcurrencyGuard(2);
    expect(await guard.acquire("device-a")).toBe(true);
    expect(await guard.acquire("device-a")).toBe(true);
    // A second device behind the same IP (not modelled here — the key
    // IS the device, never the IP) gets its own standing.
    expect(await guard.acquire("device-b")).toBe(true);
    expect(await guard.acquire("device-b")).toBe(true);
  });

  it("release frees a slot for the next acquire", async () => {
    const guard = new InMemoryConcurrencyGuard(1);
    expect(await guard.acquire("device-a")).toBe(true);
    expect(await guard.acquire("device-a")).toBe(false);
    await guard.release("device-a");
    expect(await guard.acquire("device-a")).toBe(true);
  });
});
