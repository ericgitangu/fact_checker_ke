import type { SubmissionStatus } from "@fact-checker-ke/core";

/**
 * ADR-0018 client: watch a submission move through
 * received -> analyzing -> analyzed -> verifying -> ready | failed.
 *
 * - Opens an `EventSource` against the same-origin SSE proxy
 *   (`/api/submissions/:id/events` — see that route's own comment for why
 *   it proxies instead of hitting services/api directly).
 * - Resumes with `Last-Event-ID` on reconnect (native `EventSource`
 *   behaviour; we additionally track the last id ourselves so the
 *   polling fallback can report a resume point too, even though it won't
 *   use it directly as the REST endpoint isn't id-based).
 * - After 2 failed reconnects (ADR-0018 point 4), stops retrying SSE and
 *   switches to polling `GET /api/submissions/:id` with `ETag` /
 *   `If-None-Match` every 3s with linear backoff, capped.
 * - Exposes a small dependency-injected constructor (`EventSourceCtor`,
 *   `fetchImpl`) so this is unit-testable without a real network or a
 *   real `EventSource` (jsdom doesn't ship one).
 */

export interface SubmissionEventsCallbacks {
  onStatus: (status: SubmissionStatus) => void;
  onError?: (message: string) => void;
  /** Called when falling back from SSE to polling after repeated failures. */
  onModeChange?: (mode: "sse" | "polling") => void;
}

export interface SubmissionEventsOptions {
  maxReconnectAttempts?: number;
  pollIntervalMs?: number;
  pollBackoffFactor?: number;
  maxPollIntervalMs?: number;
  EventSourceCtor?: typeof EventSource;
  fetchImpl?: typeof fetch;
}

interface MinimalEventSource {
  close(): void;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null;
  onopen: ((this: EventSource, ev: Event) => unknown) | null;
}

const STATUS_VALUES: readonly SubmissionStatus[] = [
  "received",
  "analyzing",
  "analyzed",
  "verifying",
  "ready",
  "failed",
  // ADR-0038: distinct non-error terminal outcomes.
  "needs_quote",
  "no_checkable_claims",
];

/** Terminal statuses: no further transitions, so the stream/poll can stop. */
export function isTerminalStatus(status: SubmissionStatus): boolean {
  return (
    status === "ready" ||
    status === "failed" ||
    status === "needs_quote" ||
    status === "no_checkable_claims"
  );
}

function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && (STATUS_VALUES as readonly string[]).includes(value);
}

function parseStatusPayload(raw: string): SubmissionStatus | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "status" in parsed) {
      const status = (parsed as { status: unknown }).status;
      if (isSubmissionStatus(status)) return status;
    }
    // The server may also send a bare status string.
    if (isSubmissionStatus(parsed)) return parsed;
  } catch {
    if (isSubmissionStatus(raw)) return raw;
  }
  return null;
}

export interface SubmissionEventsHandle {
  close: () => void;
}

export function subscribeToSubmissionEvents(
  submissionId: string,
  callbacks: SubmissionEventsCallbacks,
  options: SubmissionEventsOptions = {},
): SubmissionEventsHandle {
  const {
    maxReconnectAttempts = 2,
    pollIntervalMs = 3_000,
    pollBackoffFactor = 1.5,
    maxPollIntervalMs = 15_000,
    EventSourceCtor,
    fetchImpl = fetch,
  } = options;

  let closed = false;
  let reconnectAttempts = 0;
  let source: MinimalEventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEtag: string | null = null;
  const seenEventIds = new Set<string>();

  function dedupAndEmit(eventId: string | undefined, status: SubmissionStatus): void {
    if (eventId) {
      if (seenEventIds.has(eventId)) return;
      seenEventIds.add(eventId);
    }
    callbacks.onStatus(status);
  }

  function startPolling(): void {
    callbacks.onModeChange?.("polling");
    let interval = pollIntervalMs;

    async function tick(): Promise<void> {
      if (closed) return;
      try {
        const res = await fetchImpl(`/api/submissions/${encodeURIComponent(submissionId)}`, {
          headers: lastEtag ? { "if-none-match": lastEtag } : undefined,
        });
        if (res.status === 304) {
          // No change — nothing to do, just keep polling.
        } else if (res.ok) {
          const etag = res.headers.get("etag");
          if (etag) lastEtag = etag;
          const body: unknown = await res.json();
          if (typeof body === "object" && body !== null && "status" in body) {
            const status = (body as { status: unknown }).status;
            if (isSubmissionStatus(status)) {
              dedupAndEmit(undefined, status);
              if (isTerminalStatus(status)) {
                closed = true;
                return;
              }
            }
          }
        } else {
          callbacks.onError?.(`Polling failed with status ${res.status}`);
        }
      } catch {
        callbacks.onError?.("Polling network error");
      }
      if (closed) return;
      interval = Math.min(interval * pollBackoffFactor, maxPollIntervalMs);
      pollTimer = setTimeout(() => void tick(), interval);
    }

    pollTimer = setTimeout(() => void tick(), 0);
  }

  function connect(): void {
    if (closed) return;
    const Ctor = EventSourceCtor ?? (typeof EventSource !== "undefined" ? EventSource : undefined);
    if (!Ctor) {
      // No EventSource available at all (e.g. a non-browser test runner
      // without an injected ctor) — go straight to polling.
      startPolling();
      return;
    }

    const es = new Ctor(`/api/submissions/${encodeURIComponent(submissionId)}/events`) as unknown as MinimalEventSource;
    source = es;

    es.onopen = () => {
      reconnectAttempts = 0;
      callbacks.onModeChange?.("sse");
    };

    es.onmessage = (ev: MessageEvent) => {
      const status = parseStatusPayload(String(ev.data));
      if (status) {
        dedupAndEmit(ev.lastEventId || undefined, status);
        if (isTerminalStatus(status)) {
          close();
        }
      }
    };

    es.onerror = () => {
      es.close();
      source = null;
      if (closed) return;
      reconnectAttempts += 1;
      if (reconnectAttempts > maxReconnectAttempts) {
        startPolling();
        return;
      }
      callbacks.onError?.(`SSE reconnect attempt ${reconnectAttempts}`);
      connect();
    };
  }

  function close(): void {
    closed = true;
    source?.close();
    source = null;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  connect();

  return { close };
}
