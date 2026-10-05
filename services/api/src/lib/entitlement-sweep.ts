import type { EntitlementRepository } from "../repositories/types.js";

export interface EntitlementSweepResult {
  /** Rows transitioned `active` → `expired` by this run. */
  expired: number;
  /** Stale pending-checkout→subject mappings pruned by this run. */
  pendingPruned: number;
}

/**
 * How long a pending-checkout→subject mapping is kept before the sweeper
 * prunes it. An M-Pesa STK prompt expires in ~1 minute and a hosted
 * checkout is abandoned long before a day; 1 day is a wide, conservative
 * margin (covers a delayed PSP callback) while bounding table growth. A
 * pruned-then-arriving callback degrades safely to "no subject → no grant".
 */
const PENDING_CHECKOUT_PRUNE_CUTOFF_DAYS = 1;

/**
 * ADR-0012 §3 (monetization v2): the entitlement expiry sweeper.
 *
 * The ad-free / premium DECISION is already correct lazily — `isActiveNow`
 * (lib/entitlement.ts) denies a lapsed `active` row at read time regardless
 * of its stored `status`. This sweeper makes that terminal state DURABLE so
 * access is not ONLY lazy-evaluated: it flips every lapsed `active` row to
 * `expired` (the terminal label) so an admin/analytics query reading
 * `status` directly sees the truth, and so a future renewal path never has
 * to reason about "active-but-actually-expired" rows.
 *
 * Invoked two ways (ADR-0021's "piggyback on the sweeper" pattern — see
 * runRetentionSweep, which the existing `/internal/outbox/drain` already
 * calls):
 *   1. piggybacked on `/internal/outbox/drain` (so it runs on the EXISTING
 *      QStash sweeper schedule, no new cron required), and
 *   2. as a dedicated, independently-schedulable `/internal/entitlements/
 *      sweep` route (same QStash signature verification as the other
 *      /internal routes) for when the owner wants to tune its cadence
 *      separately from the outbox drain.
 * Both call this one function, so the behaviour is identical whichever
 * trigger fires. It is idempotent: a second run finds nothing left to flip.
 */
export async function runEntitlementSweep(
  entitlements: EntitlementRepository,
  now: Date = new Date(),
): Promise<EntitlementSweepResult> {
  const { expired } = await entitlements.sweepExpired(now);
  const cutoff = new Date(now.getTime() - PENDING_CHECKOUT_PRUNE_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  const { pruned } = await entitlements.prunePendingCheckouts(cutoff);
  return { expired, pendingPruned: pruned };
}
