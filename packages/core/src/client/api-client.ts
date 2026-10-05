import { SubmissionInputSchema, type SubmissionInput } from "../schemas/submission.js";
import { CheckSchema, type Check } from "../schemas/check.js";
import {
  MaandamanoResponseSchema,
  type MaandamanoResponse,
  MaandamanoArchiveResponseSchema,
  type MaandamanoArchiveResponse,
} from "../schemas/demonstration.js";
import { FeedResponseSchema, type FeedResponse } from "../schemas/feed.js";
import { TrendingResponseSchema, type TrendingResponse } from "../schemas/trending.js";
import { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const SubmissionAcceptedSchema = z.object({ id: z.string().uuid() });

/**
 * Thin typed wrapper around services/api's public HTTP surface. Validates
 * responses at the boundary with the same zod schemas the server uses, so a
 * contract drift fails loudly in the client rather than producing `any`.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async submit(input: SubmissionInput): Promise<{ id: string }> {
    const parsed = SubmissionInputSchema.parse(input);
    const res = await this.fetchImpl(`${this.baseUrl}/v1/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (res.status !== 202) {
      throw new ApiClientError(`Unexpected status submitting: ${res.status}`, res.status);
    }
    const body: unknown = await res.json();
    return SubmissionAcceptedSchema.parse(body);
  }

  async getCheck(id: string): Promise<Check> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/checks/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      throw new ApiClientError(`Check ${id} not found`, 404);
    }
    if (!res.ok) {
      throw new ApiClientError(`Unexpected status fetching check: ${res.status}`, res.status);
    }
    const body: unknown = await res.json();
    return CheckSchema.parse(body);
  }

  /**
   * ADR-0007 kill-switch mechanism (AT-0007-A): `GET /v1/maandamano`.
   * `fetchOptions` is passed through verbatim to the underlying fetch
   * call so a Next.js caller can attach `next: { tags: ["maandamano"],
   * revalidate: ... }` for ISR (see apps/web/app/maandamano/page.tsx)
   * without this package taking a dependency on Next's types -- the
   * `next` property is a valid extra field on `RequestInit` only once
   * Next's own ambient type augmentation is in scope at the CALL site,
   * which is true for every app/** caller.
   */
  async getMaandamano(fetchOptions?: RequestInit): Promise<MaandamanoResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/maandamano`, fetchOptions);
    if (!res.ok) {
      throw new ApiClientError(`Unexpected status fetching maandamano advisories: ${res.status}`, res.status);
    }
    const body: unknown = await res.json();
    return MaandamanoResponseSchema.parse(body);
  }

  /**
   * ADR-0035 archive read model (AT-0035-5): `GET /v1/maandamano/archive`
   * — `ended`/`cancelled` advisories with their status history + source/
   * embed links, never raw media. Kill-switch-gated through the same
   * frozen check as the live list (AT-0035-4). `fetchOptions` is passed
   * through verbatim (same rationale as `getMaandamano`).
   */
  async getMaandamanoArchive(fetchOptions?: RequestInit): Promise<MaandamanoArchiveResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/maandamano/archive`, fetchOptions);
    if (!res.ok) {
      throw new ApiClientError(`Unexpected status fetching maandamano archive: ${res.status}`, res.status);
    }
    const body: unknown = await res.json();
    return MaandamanoArchiveResponseSchema.parse(body);
  }

  /**
   * ADR-0032 payoff: `GET /v1/feed` — recently PUBLISHED checks (fetch-
   * or submission-sourced), newest first, keyset-paginated. `fetchOptions`
   * is passed through verbatim (same rationale as `getMaandamano`) so a
   * Next.js Server Component caller can attach `next: { revalidate }`.
   */
  async getFeed(options?: { limit?: number; cursor?: string | null }, fetchOptions?: RequestInit): Promise<FeedResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);
    const qs = params.toString();
    const res = await this.fetchImpl(`${this.baseUrl}/v1/feed${qs ? `?${qs}` : ""}`, fetchOptions);
    if (!res.ok) {
      throw new ApiClientError(`Unexpected status fetching feed: ${res.status}`, res.status);
    }
    const body: unknown = await res.json();
    return FeedResponseSchema.parse(body);
  }

  /**
   * "Trending / under review" stream — fetch-DISCOVERED viral items ordered by
   * virality, each with a derived status (monitoring / under_review /
   * published / dismissed). Validates against the same zod schema the server
   * uses, so contract drift throws rather than yielding `any`.
   */
  async getTrending(options?: { limit?: number }, fetchOptions?: RequestInit): Promise<TrendingResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    const res = await this.fetchImpl(`${this.baseUrl}/v1/trending${qs ? `?${qs}` : ""}`, fetchOptions);
    if (!res.ok) {
      throw new ApiClientError(`Unexpected status fetching trending: ${res.status}`, res.status);
    }
    const body: unknown = await res.json();
    return TrendingResponseSchema.parse(body);
  }
}
