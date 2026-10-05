import { describe, expect, it } from "vitest";
import { InMemoryEntitlementRepository } from "../repositories/in-memory.js";
import { runEntitlementSweep } from "../lib/entitlement-sweep.js";

const NOW = new Date("2026-10-05T00:00:00.000Z");
const PAST = new Date("2026-09-01T00:00:00.000Z");
const FUTURE = new Date("2026-12-01T00:00:00.000Z");

async function seed(): Promise<InMemoryEntitlementRepository> {
  const repo = new InMemoryEntitlementRepository();
  // Lapsed active → should flip to expired.
  await repo.activateDeviceEntitlement({ deviceTokenHash: "dh_lapsed", tier: "premium", provider: "mpesa", providerRef: "ref_lapsed", currentPeriodEnd: PAST });
  // Active, still in period → untouched.
  await repo.activateDeviceEntitlement({ deviceTokenHash: "dh_valid", tier: "premium", provider: "stripe", providerRef: "ref_valid", currentPeriodEnd: FUTURE });
  // Never-expiring manual comp (null period) → never swept.
  await repo.activateDeviceEntitlement({ deviceTokenHash: "dh_comp", tier: "premium", provider: "paystack", providerRef: "ref_comp", currentPeriodEnd: null });
  return repo;
}

describe("runEntitlementSweep (ADR-0012 monetization v2)", () => {
  it("flips only lapsed active rows to expired, leaving valid + never-expiring rows", async () => {
    const repo = await seed();
    const res = await runEntitlementSweep(repo, NOW);
    expect(res.expired).toBe(1);

    expect((await repo.getLatestForDevice("dh_lapsed"))?.status).toBe("expired");
    expect((await repo.getLatestForDevice("dh_valid"))?.status).toBe("active");
    expect((await repo.getLatestForDevice("dh_comp"))?.status).toBe("active");
  });

  it("is idempotent — a second run flips nothing further", async () => {
    const repo = await seed();
    await runEntitlementSweep(repo, NOW);
    const second = await runEntitlementSweep(repo, NOW);
    expect(second.expired).toBe(0);
  });

  it("prunes pending-checkout mappings older than the cutoff, keeping fresh ones", async () => {
    const repo = new InMemoryEntitlementRepository();
    await repo.putPendingSubject({ provider: "mpesa", reference: "ws_old", deviceTokenHash: "dh" });
    // Force the stored row's createdAt into the deep past by re-inserting via a
    // sweep cutoff far in the FUTURE (anything older than cutoff is pruned).
    const farFuture = new Date("2027-01-01T00:00:00.000Z");
    const res = await runEntitlementSweep(repo, farFuture);
    expect(res.pendingPruned).toBe(1);
    expect(await repo.getPendingSubject({ provider: "mpesa", reference: "ws_old" })).toBeNull();
  });
});
