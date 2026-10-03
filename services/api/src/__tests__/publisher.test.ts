import { describe, expect, it } from "vitest";
import { FakePublisher } from "../lib/publisher.js";

describe("FakePublisher (ADR-0017 §1 dedup-id semantics)", () => {
  it("publishing the same deduplicationId twice does not fan out twice", async () => {
    const publisher = new FakePublisher();
    const first = await publisher.publish({ url: "http://x", body: { a: 1 }, deduplicationId: "dedup-1" });
    const second = await publisher.publish({ url: "http://x", body: { a: 1 }, deduplicationId: "dedup-1" });

    expect(second.messageId).toBe(first.messageId);
    expect(publisher.published).toHaveLength(1);
  });

  it("different dedup ids each produce their own publish", async () => {
    const publisher = new FakePublisher();
    await publisher.publish({ url: "http://x", body: {}, deduplicationId: "a" });
    await publisher.publish({ url: "http://x", body: {}, deduplicationId: "b" });
    expect(publisher.published).toHaveLength(2);
  });
});
