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

  constructor(restUrl: string, restToken: string, limit: number, windowSeconds: number, prefix: string) {
    const redis = new Redis({ url: restUrl, token: restToken });
    this.limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      prefix,
    });
  }

  async check(key: string): Promise<boolean> {
    const result = await this.limiter.limit(key);
    return result.success;
  }
}

type UpstashConfig = { upstashRedisRestUrl: string | null; upstashRedisRestToken: string | null };

/**
 * Generic sliding-window limiter factory. Each caller passes its own
 * `prefix` so the Redis windows never collide across endpoints (waitlist,
 * device-mint, …). Falls back to the loud no-op when Upstash env is unset
 * (dev/test). `scope` names the endpoint in the no-op warning.
 */
function createRateLimiter(
  config: UpstashConfig,
  warn: (msg: string) => void,
  opts: { limit: number; windowSeconds: number; prefix: string; scope: string },
): RateLimiter {
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    return new UpstashRateLimiter(
      config.upstashRedisRestUrl,
      config.upstashRedisRestToken,
      opts.limit,
      opts.windowSeconds,
      opts.prefix,
    );
  }
  return new NoopRateLimiter((_msg) => warn(`Upstash env unset — ${opts.scope} rate limiting is DISABLED (no-op).`));
}

export function createWaitlistRateLimiter(config: UpstashConfig, warn: (msg: string) => void): RateLimiter {
  // 5 requests/min per key (client IP), per the task brief.
  return createRateLimiter(config, warn, {
    limit: 5,
    windowSeconds: 60,
    prefix: "fact-checker-ke:ratelimit:waitlist",
    scope: "waitlist",
  });
}

/**
 * COST-CONTROL (security audit G2, 2026-10-09): `POST /v1/device` previously
 * minted a fresh 1-year quota token on every call with no throttle, so a script
 * could loop it to defeat the per-device submission quota and drive unbounded
 * downstream LLM spend. This throttles token MINTING to 10/IP/hour — generous
 * for a real browser (which mints once and caches), punitive for a minting loop.
 * Keyed on client IP (minting is pre-token, so there is no device key yet).
 */
export function createDeviceMintRateLimiter(config: UpstashConfig, warn: (msg: string) => void): RateLimiter {
  return createRateLimiter(config, warn, {
    limit: 10,
    windowSeconds: 3600,
    prefix: "fact-checker-ke:ratelimit:device-mint",
    scope: "device-mint",
  });
}
