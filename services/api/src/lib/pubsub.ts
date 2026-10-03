import { EventEmitter } from "node:events";
import { Redis as IORedis } from "ioredis";

/**
 * ADR-0018 §SSE: the relay PUBLISHes a compact message to `sub:{id}`
 * after commit; the SSE handler SUBSCRIBEs to the same channel. Behind
 * one interface so the handler/relay code never know whether they're
 * talking to a live Upstash TCP endpoint or the in-process fallback.
 */
export interface PubSub {
  publish(channel: string, message: string): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/**
 * Real implementation: Upstash Redis over TCP (TLS), per ADR-0018 —
 * "Upstash supports SUBSCRIBE/PUBLISH over TCP. There's no official
 * REST/SSE subscribe." ioredis is used (not @upstash/redis, which is
 * REST-only and can't SUBSCRIBE).
 *
 * [UNVERIFIED-LIVE]: this implementation has not been exercised against
 * a live Upstash TCP endpoint in this change — the sandbox this was
 * built in cannot reach Upstash (see ADR-0018 implementation notes). It
 * is exercised against local `redis:7-alpine` via docker compose, which
 * speaks the same TCP SUBSCRIBE/PUBLISH protocol.
 */
export class IORedisPubSub implements PubSub {
  private readonly publisher: IORedis;
  private readonly subscribers = new Set<IORedis>();

  constructor(private readonly url: string) {
    this.publisher = new IORedis(url, {
      tls: url.startsWith("rediss://") ? {} : undefined,
      maxRetriesPerRequest: 3,
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>> {
    // ioredis requires a DEDICATED connection once it enters subscribe
    // mode (it can no longer issue other commands on that connection).
    const sub = new IORedis(this.url, { tls: this.url.startsWith("rediss://") ? {} : undefined });
    this.subscribers.add(sub);
    await sub.subscribe(channel);
    const listener = (ch: string, msg: string) => {
      if (ch === channel) onMessage(msg);
    };
    sub.on("message", listener);
    return async () => {
      sub.off("message", listener);
      await sub.unsubscribe(channel).catch(() => {});
      sub.disconnect();
      this.subscribers.delete(sub);
    };
  }

  async close(): Promise<void> {
    for (const sub of this.subscribers) sub.disconnect();
    this.publisher.disconnect();
  }
}

/**
 * In-process fallback (ADR-0018/task brief): used when the TCP connect
 * to Upstash fails, behind the same `PubSub` interface, so SSE delivery
 * degrades to "only visible within this one process" rather than
 * breaking outright. A single Cloud-Run instance with min-instances=0
 * already serves one request/stream at a time per container in the
 * common case, so this is a real (if degraded) fallback, not a no-op —
 * but it does NOT fan out across multiple instances, which the Redis
 * implementation does. Also used by default in unit tests.
 */
export class InMemoryPubSub implements PubSub {
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(0);
  }

  async publish(channel: string, message: string): Promise<void> {
    this.bus.emit(channel, message);
  }

  async subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>> {
    const listener = (message: string) => onMessage(message);
    this.bus.on(channel, listener);
    return async () => {
      this.bus.off(channel, listener);
    };
  }

  async close(): Promise<void> {
    this.bus.removeAllListeners();
  }
}

/**
 * Attempts a live TCP connect to `url` with a short timeout; returns an
 * `IORedisPubSub` on success, else an `InMemoryPubSub`, logging the
 * fallback decision (never silently) via `warn`.
 */
export async function createPubSub(url: string | null, warn: (msg: string) => void): Promise<PubSub> {
  if (!url) {
    warn("REDIS_TCP_URL unset — SSE pub/sub falling back to in-process EventEmitter (single-instance only).");
    return new InMemoryPubSub();
  }
  const probe = new IORedis(url, {
    tls: url.startsWith("rediss://") ? {} : undefined,
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
  });
  try {
    await probe.connect();
    await probe.ping();
    probe.disconnect();
    return new IORedisPubSub(url);
  } catch (err) {
    probe.disconnect();
    warn(
      `Redis TCP connect failed (${err instanceof Error ? err.message : String(err)}) — SSE pub/sub ` +
        "falling back to in-process EventEmitter [UNVERIFIED-LIVE fallback path].",
    );
    return new InMemoryPubSub();
  }
}
