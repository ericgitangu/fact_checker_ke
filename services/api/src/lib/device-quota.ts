/**
 * ADR-0020 §1/§6 + ADR-0011: "per-device daily submission quota in
 * Redis... This token, not the client IP, is the quota key." Keyed on
 * the device token (never IP), closing red-team C-9 (CGNAT) the same
 * way `lib/concurrency-guard.ts` does for SSE streams.
 *
 * The daily limit (`DEFAULT_DAILY_SUBMISSION_LIMIT`) isn't pinned by
 * the ADR text itself (ADR-0011's review trigger says "set from week-1
 * data") — 20/day/device is a conservative placeholder pending that
 * data, documented here rather than silently hardcoded without comment.
 */
export const DEFAULT_DAILY_SUBMISSION_LIMIT = 20;

export interface DeviceQuotaGuard {
  /** Returns true if `deviceToken` may submit again today, consuming one unit of quota if so. */
  checkAndConsume(deviceToken: string): Promise<boolean>;
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export class InMemoryDeviceQuotaGuard implements DeviceQuotaGuard {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit = DEFAULT_DAILY_SUBMISSION_LIMIT) {}

  async checkAndConsume(deviceToken: string): Promise<boolean> {
    const key = `${utcDateKey(new Date())}:${deviceToken}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.counts.set(key, current + 1);
    return true;
  }
}

export interface RedisCounterLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export class RedisDeviceQuotaGuard implements DeviceQuotaGuard {
  constructor(
    private readonly redis: RedisCounterLike,
    private readonly limit = DEFAULT_DAILY_SUBMISSION_LIMIT,
  ) {}

  async checkAndConsume(deviceToken: string): Promise<boolean> {
    const key = `device-quota:${utcDateKey(new Date())}:${deviceToken}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      // Only set the TTL on the first increment of the day for this
      // device — re-setting it on every call would mean a chatty
      // device never actually expires its own counter key.
      await this.redis.expire(key, 26 * 60 * 60); // 26h: covers a day plus clock-skew slack
    }
    return count <= this.limit;
  }
}
