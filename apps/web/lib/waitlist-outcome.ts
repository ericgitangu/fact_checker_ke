import { WaitlistSignupResultSchema } from "@fact-checker-ke/core";

/**
 * Classifies a /v1/waitlist response by HTTP semantics (status class +
 * standard Retry-After header) rather than by response body, so the client
 * stays correct regardless of the API's error-body format.
 *
 * Ported verbatim from the retired apps/site (waitlist-outcome.ts) during
 * the single-frontend consolidation — the contract (packages/core's
 * WaitlistSignupResultSchema) is unchanged, so the classification logic is
 * too. The web BFF (app/api/waitlist/route.ts) forwards services/api's
 * status code and Retry-After through unchanged, so this runs against the
 * same semantics it always did.
 */
export type WaitlistOutcome =
  | { kind: "joined" }
  | { kind: "already_joined" }
  | { kind: "invalid" }
  | { kind: "rate_limited"; retryAfterSec: number | null }
  | { kind: "server_error" } // 5xx — retryable, not the user's fault
  | { kind: "unexpected"; status: number }; // other status / contract drift — not retryable

export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const at = Date.parse(header); // HTTP-date form
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

export async function classifyWaitlistResponse(res: Response): Promise<WaitlistOutcome> {
  if (res.status === 400) return { kind: "invalid" };
  if (res.status === 429) {
    return { kind: "rate_limited", retryAfterSec: parseRetryAfter(res.headers.get("retry-after")) };
  }
  if (res.status >= 500) return { kind: "server_error" };
  if (res.status !== 200 && res.status !== 201) return { kind: "unexpected", status: res.status };

  const body: unknown = await res.json().catch(() => null);
  const parsed = WaitlistSignupResultSchema.safeParse(body);
  // A 2xx whose body breaks the contract is API/client drift, not a network fault.
  if (!parsed.success) return { kind: "unexpected", status: res.status };
  return { kind: parsed.data.status };
}
