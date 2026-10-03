import type { Check, Rating } from "@fact-checker-ke/core";

/**
 * SEAM — NOT YET IMPLEMENTED SERVER-SIDE.
 *
 * services/api has no `/v1/editor/*` routes today (verified: only
 * `checks.test.ts` exists under services/api, no editor route file). This
 * module is the client-side typed contract the editor UI (`/editor`)
 * builds against, so the UI, its tests, and the eventual backend route
 * all agree on one shape ahead of time. The invented endpoints below are
 * a minimal, clearly-commented guess at the shape ADR-0004/0024 implies
 * (approve publishes the AI draft as-is; correct lets an editor override
 * rating/summary before publishing) — the backend/auth agent owns turning
 * these into real routes and should feel free to adjust the shape; this
 * file is the seam, not a frozen contract.
 *
 * `fetchImpl` is injectable for tests/dev mocking (same pattern as
 * ApiClient and lib/submission-events.ts).
 */

export interface EditorDraftSummary {
  check: Check;
  submissionUrl: string | null;
  submissionText: string | null;
}

export interface CorrectPayload {
  rating: Rating;
  summary?: string;
}

export class EditorClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EditorClientError";
  }
}

export class EditorClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** `GET /v1/editor/queue` — the real backend route (services/api
   * routes/editor.ts) returns `{ items: EditorDraftSummary[] }`. */
  async listDrafts(): Promise<EditorDraftSummary[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/editor/queue`);
    if (!res.ok) {
      throw new EditorClientError(`Failed to list drafts: ${res.status}`, res.status);
    }
    const body = (await res.json()) as { items: EditorDraftSummary[] };
    return body.items;
  }

  /** `POST /v1/editor/checks/:id/approve` — approves the AI draft as-is,
   * which publishes it (services/api routes/editor.ts). */
  async publish(checkId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/editor/checks/${encodeURIComponent(checkId)}/approve`, {
      method: "POST",
    });
    if (!res.ok) {
      throw new EditorClientError(`Failed to approve check ${checkId}: ${res.status}`, res.status);
    }
  }

  /** `POST /v1/editor/checks/:id/correct` — editor overrides rating/summary, then publishes. */
  async correct(checkId: string, payload: CorrectPayload): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/editor/checks/${encodeURIComponent(checkId)}/correct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new EditorClientError(`Failed to correct check ${checkId}: ${res.status}`, res.status);
    }
  }
}
