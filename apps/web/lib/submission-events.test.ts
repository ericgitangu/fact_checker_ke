import { describe, it, expect, vi, afterEach } from "vitest";
import { subscribeToSubmissionEvents } from "./submission-events";

/**
 * Minimal mock EventSource: lets a test fire onopen/onmessage/onerror
 * directly and records how many instances were constructed (one per
 * (re)connect attempt).
 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown, lastEventId = ""): void {
    this.onmessage?.({ data: JSON.stringify(data), lastEventId } as MessageEvent);
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

function resetMock(): void {
  MockEventSource.instances = [];
}

afterEach(() => {
  resetMock();
  vi.useRealTimers();
});

describe("subscribeToSubmissionEvents", () => {
  it("emits statuses from SSE messages in order, deduping by event id", () => {
    const statuses: string[] = [];
    subscribeToSubmissionEvents(
      "sub-1",
      { onStatus: (s) => statuses.push(s) },
      { EventSourceCtor: MockEventSource as unknown as typeof EventSource },
    );
    const es = MockEventSource.instances[0]!;
    es.emit({ status: "received" }, "evt-1");
    es.emit({ status: "analyzing" }, "evt-2");
    es.emit({ status: "analyzing" }, "evt-2"); // duplicate, same event id
    expect(statuses).toEqual(["received", "analyzing"]);
  });

  it("closes the stream once a terminal status (ready) arrives", () => {
    const statuses: string[] = [];
    subscribeToSubmissionEvents(
      "sub-2",
      { onStatus: (s) => statuses.push(s) },
      { EventSourceCtor: MockEventSource as unknown as typeof EventSource },
    );
    const es = MockEventSource.instances[0]!;
    es.emit({ status: "ready" }, "evt-1");
    expect(statuses).toEqual(["ready"]);
    expect(es.closed).toBe(true);
  });

  it("closes the stream once a terminal status (failed) arrives", () => {
    const statuses: string[] = [];
    subscribeToSubmissionEvents(
      "sub-3",
      { onStatus: (s) => statuses.push(s) },
      { EventSourceCtor: MockEventSource as unknown as typeof EventSource },
    );
    const es = MockEventSource.instances[0]!;
    es.emit({ status: "failed" }, "evt-1");
    expect(statuses).toEqual(["failed"]);
    expect(es.closed).toBe(true);
  });

  it.each(["needs_quote", "no_checkable_claims"] as const)(
    "treats %s as terminal (ADR-0038) and closes the stream",
    (terminal) => {
      const statuses: string[] = [];
      subscribeToSubmissionEvents(
        "sub-t",
        { onStatus: (s) => statuses.push(s) },
        { EventSourceCtor: MockEventSource as unknown as typeof EventSource },
      );
      const es = MockEventSource.instances[0]!;
      es.emit({ status: terminal }, "evt-t");
      expect(statuses).toEqual([terminal]);
      expect(es.closed).toBe(true);
    },
  );

  it("reconnects on error up to maxReconnectAttempts, creating a new EventSource each time", () => {
    const modeChanges: string[] = [];
    subscribeToSubmissionEvents(
      "sub-4",
      { onStatus: () => {}, onModeChange: (m) => modeChanges.push(m) },
      { EventSourceCtor: MockEventSource as unknown as typeof EventSource, maxReconnectAttempts: 2 },
    );
    expect(MockEventSource.instances).toHaveLength(1);
    MockEventSource.instances[0]!.fail();
    expect(MockEventSource.instances).toHaveLength(2); // 1st reconnect
    MockEventSource.instances[1]!.fail();
    expect(MockEventSource.instances).toHaveLength(3); // 2nd reconnect
    // modeChanges should not include "polling" yet — still within budget.
    expect(modeChanges).not.toContain("polling");
  });

  it("falls back to polling after exceeding maxReconnectAttempts", async () => {
    vi.useFakeTimers();
    const modeChanges: string[] = [];
    const statuses: string[] = [];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: "verifying" }), {
        status: 200,
        headers: { etag: '"v1"' },
      }),
    );

    subscribeToSubmissionEvents(
      "sub-5",
      { onStatus: (s) => statuses.push(s), onModeChange: (m) => modeChanges.push(m) },
      {
        EventSourceCtor: MockEventSource as unknown as typeof EventSource,
        maxReconnectAttempts: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pollIntervalMs: 100,
      },
    );

    MockEventSource.instances[0]!.fail(); // reconnect 1
    MockEventSource.instances[1]!.fail(); // exceeds budget -> polling

    expect(modeChanges).toContain("polling");

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["verifying"]);

    await vi.advanceTimersByTimeAsync(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops polling once a terminal status is observed via polling", async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      const status = call === 1 ? "verifying" : "ready";
      return new Response(JSON.stringify({ status }), { status: 200 });
    });

    subscribeToSubmissionEvents(
      "sub-6",
      { onStatus: (s) => statuses.push(s) },
      {
        EventSourceCtor: MockEventSource as unknown as typeof EventSource,
        maxReconnectAttempts: 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pollIntervalMs: 100,
      },
    );

    MockEventSource.instances[0]!.fail(); // exceeds budget (0) -> polling immediately

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(500);

    expect(statuses).toEqual(["verifying", "ready"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no further polling after terminal
  });

  it("close() stops both SSE and any pending poll", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "verifying" }), { status: 200 }));
    const handle = subscribeToSubmissionEvents(
      "sub-7",
      { onStatus: () => {} },
      {
        EventSourceCtor: MockEventSource as unknown as typeof EventSource,
        maxReconnectAttempts: 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pollIntervalMs: 100,
      },
    );
    MockEventSource.instances[0]!.fail();
    handle.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
