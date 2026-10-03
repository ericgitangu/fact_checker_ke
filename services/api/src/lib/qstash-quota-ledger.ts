/**
 * AT-0017-A / ADR-0009 red-team Amendment #2: "Add a QStash quota
 * ledger: daily messages = 2 × subs + retries + sweeps + callbacks."
 * Pure, dependency-free so it can be asserted against in a fast unit
 * test (no QStash account needed to check the ARITHMETIC) and reused
 * by an alerting job later (ADR-0019 Amendment #13: "alert at 70% of
 * the 1,000 msg/day free-tier ceiling").
 */
export interface QStashQuotaLedgerInput {
  /** Submissions/day. Each submission is 2 hops (analyze, verify) per the accepted two-hop pipeline (ADR-0009). */
  submissionsPerDay: number;
  /** Estimated retried messages/day (transient failures re-delivered). */
  retriesPerDay: number;
  /** Sweeper runs/day. At most hourly per ADR-0017's red-team Amendment #2 (24 is the ceiling at that cadence). */
  sweepsPerDay: number;
  /** Failure-callback messages/day (ADR-0017 §4). */
  callbacksPerDay: number;
}

export const QSTASH_FREE_TIER_DAILY_MESSAGE_LIMIT = 1_000;
export const QSTASH_ALERT_THRESHOLD_RATIO = 0.7; // ADR-0019 Amendment #13.

export function projectedDailyQStashMessages(input: QStashQuotaLedgerInput): number {
  return 2 * input.submissionsPerDay + input.retriesPerDay + input.sweepsPerDay + input.callbacksPerDay;
}

export function isWithinQStashFreeTier(input: QStashQuotaLedgerInput): boolean {
  return projectedDailyQStashMessages(input) <= QSTASH_FREE_TIER_DAILY_MESSAGE_LIMIT;
}

export function exceedsQStashAlertThreshold(input: QStashQuotaLedgerInput): boolean {
  return projectedDailyQStashMessages(input) > QSTASH_FREE_TIER_DAILY_MESSAGE_LIMIT * QSTASH_ALERT_THRESHOLD_RATIO;
}
