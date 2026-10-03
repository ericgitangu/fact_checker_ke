/**
 * ADR-0018 §5 guard + red-team amendment (CGNAT, C-9): "at most 2
 * concurrent streams per device token" — keyed on the device token
 * (ADR-0020), never the bare IP, so CGNAT users sharing one egress IP
 * aren't throttled by each other's usage (AT-0018-8, AT-0020-1).
 */
export interface ConcurrencyGuard {
  /** Returns true if the caller may open another stream under `key`. */
  acquire(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}

export class InMemoryConcurrencyGuard implements ConcurrencyGuard {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  async acquire(key: string): Promise<boolean> {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.limit) return false;
    this.counts.set(key, current + 1);
    return true;
  }

  async release(key: string): Promise<void> {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) this.counts.delete(key);
    else this.counts.set(key, current - 1);
  }
}

export interface RedisCounterLike {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/**
 * TTL on the counter key bounds a leaked/never-released slot (crashed
 * connection) to at most `ttlSeconds` of lockout — never an infinite
 * "stuck at the limit forever" (ephemeral Redis use only, per ADR-0018:
 * "nothing correctness-critical lives only in Redis").
 */
export class RedisConcurrencyGuard implements ConcurrencyGuard {
  constructor(
    private readonly redis: RedisCounterLike,
    private readonly limit: number,
    private readonly ttlSeconds = 120,
  ) {}

  async acquire(key: string): Promise<boolean> {
    const redisKey = `sse-concurrency:${key}`;
    const count = await this.redis.incr(redisKey);
    await this.redis.expire(redisKey, this.ttlSeconds);
    if (count > this.limit) {
      await this.redis.decr(redisKey);
      return false;
    }
    return true;
  }

  async release(key: string): Promise<void> {
    await this.redis.decr(`sse-concurrency:${key}`);
  }
}
