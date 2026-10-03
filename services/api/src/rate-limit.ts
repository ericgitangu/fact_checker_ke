import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimiter {
  /** Returns true if the request identified by `key` is allowed. */
  check(key: string): Promise<boolean>;
}

/**
 * No-op limiter used when Upstash env vars are unset — dev/test only.
 * Logs a warning once at construction so a missing-env misconfiguration
 * in a real deployment is loud, not silent (NODE_ENV=production should
 * never reach here in practice; see config.ts — this is a defense in
 * depth for the rate limiter specifically, not a substitute for that
 * startup check).
 */
class NoopRateLimiter implements RateLimiter {
  constructor(private readonly warn: (msg: string) => void) {
    this.warn("Upstash Redis env vars unset — waitlist rate limiting is DISABLED (no-op).");
  }

  async check(): Promise<boolean> {
    return true;
  }
}

class UpstashRateLimiter implements RateLimiter {
  private readonly limiter: Ratelimit;

  constructor(restUrl: string, restToken: string, limit: number, windowSeconds: number) {
    const redis = new Redis({ url: restUrl, token: restToken });
    this.limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      prefix: "fact-checker-ke:ratelimit:waitlist",
    });
  }

  async check(key: string): Promise<boolean> {
    const result = await this.limiter.limit(key);
    return result.success;
  }
}

export function createWaitlistRateLimiter(
  config: { upstashRedisRestUrl: string | null; upstashRedisRestToken: string | null },
  warn: (msg: string) => void,
): RateLimiter {
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    // 5 requests/min per key (client IP), per the task brief.
    return new UpstashRateLimiter(config.upstashRedisRestUrl, config.upstashRedisRestToken, 5, 60);
  }
  return new NoopRateLimiter(warn);
}
