import { describe, expect, it, vi } from "vitest";
import { InMemoryPubSub, createPubSub } from "../lib/pubsub.js";

describe("InMemoryPubSub", () => {
  it("delivers a published message to a subscriber on the same channel", async () => {
    const pubsub = new InMemoryPubSub();
    const received: string[] = [];
    const unsubscribe = await pubsub.subscribe("sub:x", (msg) => received.push(msg));
    await pubsub.publish("sub:x", "hello");
    expect(received).toEqual(["hello"]);
    await unsubscribe();
    await pubsub.close();
  });

  it("does not deliver to a different channel", async () => {
    const pubsub = new InMemoryPubSub();
    const received: string[] = [];
    await pubsub.subscribe("sub:x", (msg) => received.push(msg));
    await pubsub.publish("sub:y", "hello");
    expect(received).toEqual([]);
    await pubsub.close();
  });
});

describe("createPubSub (ADR-0018 §7 degraded-not-broken fallback)", () => {
  it("falls back to InMemoryPubSub when the Redis TCP connect fails, without throwing", async () => {
    const warn = vi.fn();
    // Port 1 is reserved/unlisted; connect must fail fast given the
    // short connectTimeout createPubSub uses.
    const pubsub = await createPubSub("redis://127.0.0.1:1", warn);
    expect(pubsub).toBeInstanceOf(InMemoryPubSub);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to in-process EventEmitter"));
    await pubsub.close();
  }, 10_000);

  it("uses InMemoryPubSub directly (with a warn) when no URL is configured", async () => {
    const warn = vi.fn();
    const pubsub = await createPubSub(null, warn);
    expect(pubsub).toBeInstanceOf(InMemoryPubSub);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("REDIS_TCP_URL unset"));
    await pubsub.close();
  });
});
