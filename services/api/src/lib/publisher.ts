import { Client as QStashClient } from "@upstash/qstash";

/**
 * ADR-0017 §1/§4: the outbox relay publishes through this interface, not
 * the QStash SDK directly, so integration tests can exercise the real
 * relay code path (select FOR UPDATE SKIP LOCKED, mark published_at)
 * against a `FakePublisher` instead of a live QStash instance — QStash
 * cannot deliver callbacks to localhost, so real end-to-end delivery is
 * only verifiable after deploy (ADR-0017 "facts pending verification").
 */
export interface Publisher {
  /**
   * Publishes `body` to `url`, deduplicated by `deduplicationId` (the
   * outbox row id — ADR-0017 §1: "the outbox row id becomes the QStash
   * deduplication id"). Must be idempotent: publishing the same
   * deduplicationId twice is a no-op on QStash's side, and the fake
   * mirrors that so tests can assert on it.
   */
  publish(input: {
    url: string;
    body: unknown;
    deduplicationId: string;
  }): Promise<{ messageId: string }>;
}

export class QStashPublisher implements Publisher {
  private readonly client: QStashClient;

  constructor(token: string) {
    this.client = new QStashClient({ token });
  }

  async publish(input: { url: string; body: unknown; deduplicationId: string }): Promise<{ messageId: string }> {
    const result = await this.client.publishJSON({
      url: input.url,
      body: input.body,
      headers: { "Upstash-Deduplication-Id": input.deduplicationId },
    });
    return { messageId: result.messageId };
  }
}

/**
 * In-memory fake used by integration tests (ADR-0017 QStash-cannot-reach
 * -localhost limitation). Records every publish call and honours
 * dedup-id semantics: a second publish with a seen deduplicationId
 * returns the SAME messageId without appending to `.published`, so
 * tests can assert "never double-fanned-out" directly.
 */
export class FakePublisher implements Publisher {
  readonly published: Array<{ url: string; body: unknown; deduplicationId: string; messageId: string }> = [];
  private readonly seenDedupIds = new Map<string, string>();

  async publish(input: { url: string; body: unknown; deduplicationId: string }): Promise<{ messageId: string }> {
    const existing = this.seenDedupIds.get(input.deduplicationId);
    if (existing) {
      return { messageId: existing };
    }
    const messageId = `fake-msg-${this.published.length + 1}`;
    this.seenDedupIds.set(input.deduplicationId, messageId);
    this.published.push({ ...input, messageId });
    return { messageId };
  }
}
