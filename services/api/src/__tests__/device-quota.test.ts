import { describe, expect, it } from "vitest";
import { InMemoryDeviceQuotaGuard } from "../lib/device-quota.js";

describe("InMemoryDeviceQuotaGuard (ADR-0020 §7 per-device daily quota)", () => {
  it("allows up to the limit, then rejects for the rest of the day", async () => {
    const guard = new InMemoryDeviceQuotaGuard(2);
    expect(await guard.checkAndConsume("device-a")).toBe(true);
    expect(await guard.checkAndConsume("device-a")).toBe(true);
    expect(await guard.checkAndConsume("device-a")).toBe(false);
  });

  it("two different devices never share quota standing", async () => {
    const guard = new InMemoryDeviceQuotaGuard(1);
    expect(await guard.checkAndConsume("device-a")).toBe(true);
    expect(await guard.checkAndConsume("device-b")).toBe(true);
  });
});
