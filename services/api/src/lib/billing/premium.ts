/**
 * ADR-0012 §3 (monetization v2): Premium is sold as a fixed-length PASS, not
 * an auto-renewing subscription, for the two direct rails added here —
 * M-Pesa C2B (a one-off STK payment, no standing order) and Stripe Checkout
 * in `payment` mode (a one-off charge). Each successful payment grants
 * access for this many days from the payment time; renewal is a fresh
 * purchase. The expiry sweeper (lib/entitlement-sweep.ts) then flips a
 * lapsed pass to `expired`.
 *
 * Recurring (auto-renew) subscriptions are deliberately OUT OF SCOPE for
 * this pass (they need renewal-webhook handling — Stripe `invoice.paid`,
 * an M-Pesa standing order — which neither sandbox exercises). Flagged here
 * rather than silently assumed: a future recurring tier is additive.
 */
export const PREMIUM_PERIOD_DAYS = 30;

/** Returns `from` advanced by the Premium pass length. */
export function premiumPeriodEnd(from: Date): Date {
  return new Date(from.getTime() + PREMIUM_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}
