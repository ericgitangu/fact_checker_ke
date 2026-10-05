import { NO_ENTITLEMENT, type Entitlement } from "@fact-checker-ke/core";
import type { EntitlementRecord, EntitlementRepository } from "../repositories/types.js";

/**
 * ADR-0012 §3 — the server-authoritative access decision, as a PURE
 * function so it is unit-testable with no database and no clock mocking
 * beyond an injected `now`.
 *
 * An entitlement confers access iff its billing status is `active` AND it
 * is within its paid period. `status` ALONE is never sufficient: a
 * `canceled` row inside a still-paid period keeps access until the period
 * ends, and an `active` row whose `currentPeriodEnd` has passed does NOT
 * (a lapsed-but-not-yet-swept row). A NULL `currentPeriodEnd` is a
 * never-expiring grant (a `manual` comp), so it is active while its status
 * is `active`.
 */
export function isActiveNow(record: EntitlementRecord, now: Date = new Date()): boolean {
  // `expired` is terminal — never confers access regardless of dates.
  if (record.status === "expired") return false;
  // A null period is a never-expiring grant (a `manual` comp); it confers
  // access only while its status is `active` (a canceled comp does not).
  if (record.currentPeriodEnd === null) return record.status === "active";
  // With a period present, both `active` and `canceled` honour it until it
  // ends (cancel-at-period-end: a reader keeps the access they paid for).
  return record.currentPeriodEnd.getTime() > now.getTime();
}

/**
 * Projects a stored record (or its absence) into the public `Entitlement`
 * the client receives. Absence, or any inactive record, projects to the
 * fail-safe `NO_ENTITLEMENT` shape's access fields (ads ON, no perks) —
 * ad-free is the thing you pay for, so "unknown" always means "not
 * ad-free". When a record exists but is inactive, its `status` and
 * `currentPeriodEnd` are still returned for display, but `premium`/
 * `adFree` are false and `tier` is null.
 */
export function projectEntitlement(record: EntitlementRecord | null, now: Date = new Date()): Entitlement {
  if (!record) return NO_ENTITLEMENT;
  const active = isActiveNow(record, now);
  return {
    premium: active,
    // Today ad-free === premium. Kept as its own computed field (not an
    // alias) so a future non-ad-free paid add-on can't silently flip ads
    // back on — the contract boundary stays explicit (see EntitlementSchema).
    adFree: active,
    tier: active ? record.tier : null,
    status: record.status,
    currentPeriodEnd: record.currentPeriodEnd ? record.currentPeriodEnd.toISOString() : null,
  };
}

/**
 * Thin service over the repository: fetch-and-project for the read path.
 * The write path (applying a verified webhook) lives in the webhook route,
 * which owns the verify → dedup → activate ordering; this service is the
 * read seam the `GET /v1/entitlement` route depends on.
 */
export class EntitlementService {
  constructor(private readonly repo: EntitlementRepository) {}

  /**
   * The entitlement for a device reader. A `null`/empty device token hash
   * (an anonymous reader who never got a device token) is simply "no
   * entitlement" — never an error.
   */
  async getForDevice(deviceTokenHash: string | null, now: Date = new Date()): Promise<Entitlement> {
    if (!deviceTokenHash) return NO_ENTITLEMENT;
    const record = await this.repo.getLatestForDevice(deviceTokenHash);
    return projectEntitlement(record, now);
  }
}
