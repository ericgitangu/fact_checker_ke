import { SubmissionInputSchema, type SubmissionInput } from "../schemas/submission.js";
import { CheckSchema, type Check } from "../schemas/check.js";
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
}
