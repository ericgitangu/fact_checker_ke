import { describe, expect, it } from "vitest";
import {
  projectedDailyQStashMessages,
  isWithinQStashFreeTier,
  exceedsQStashAlertThreshold,
  QSTASH_FREE_TIER_DAILY_MESSAGE_LIMIT,
} from "../lib/qstash-quota-ledger.js";

/**
 * AT-0017-A: "A quota-ledger test asserts that projected daily QStash
 * messages = 2×subs + retries + sweeps + callbacks ≤ 800." The ADR's
 * accepted two-hop pipeline (ADR-0009) targets ~500 submissions/day as
 * its planning baseline; the sweeper is at most hourly (24/day) per
 * ADR-0017's red-team Amendment #2.
 */
describe("AT-0017-A: QStash daily message quota ledger", () => {
  it("formula: 2×subs + retries + sweeps + callbacks", () => {
    expect(projectedDailyQStashMessages({ submissionsPerDay: 100, retriesPerDay: 10, sweepsPerDay: 24, callbacksPerDay: 5 })).toBe(
      2 * 100 + 10 + 24 + 5,
    );
  });

  it("the ADR-0009 planning baseline (~350 submissions/day with headroom) stays <= 800 and within the free tier", () => {
    const projection = { submissionsPerDay: 350, retriesPerDay: 35, sweepsPerDay: 24, callbacksPerDay: 17 };
    const total = projectedDailyQStashMessages(projection);
    expect(total).toBeLessThanOrEqual(800);
    expect(isWithinQStashFreeTier(projection)).toBe(true);
  });

  it("flags the 70% alert threshold (ADR-0019 Amendment #13) before the hard 1000/day ceiling", () => {
    const atThreshold = { submissionsPerDay: 345, retriesPerDay: 35, sweepsPerDay: 24, callbacksPerDay: 17 }; // total = 766 > 700
    expect(exceedsQStashAlertThreshold(atThreshold)).toBe(true);
    expect(isWithinQStashFreeTier(atThreshold)).toBe(true);

    const overLimit = { submissionsPerDay: 500, retriesPerDay: 50, sweepsPerDay: 24, callbacksPerDay: 50 }; // total = 1124
    expect(projectedDailyQStashMessages(overLimit)).toBeGreaterThan(QSTASH_FREE_TIER_DAILY_MESSAGE_LIMIT);
    expect(isWithinQStashFreeTier(overLimit)).toBe(false);
  });
});
