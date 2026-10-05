import { NextResponse } from "next/server";
import { WaitlistSignupInputSchema } from "@fact-checker-ke/core";

/**
 * BFF proxy for the waitlist (ADR-0015: web posts same-origin, no CORS, and
 * the API base URL stays out of the client bundle). The browser posts here;
 * this route validates against packages/core's WaitlistSignupInputSchema,
 * stamps `source: "web"` server-side (the origin is authoritative here, not
 * client-supplied), and forwards to services/api's `POST /v1/waitlist`.
 *
 * It passes the upstream status code and Retry-After header straight back
 * so the client's HTTP-semantics classifier (lib/waitlist-outcome.ts) sees
 * exactly what services/api returned: 201 joined | 200 already_joined | 400
 * invalid | 429 rate limited | 5xx server error.
 *
 * The original client IP is forwarded (x-forwarded-for / x-real-ip) so
 * services/api rate-limits per end-user, not per serverless instance —
 * without it every signup would share this function's egress IP and the
 * limiter (services/api/src/routes/waitlist.ts) would bucket all users
 * together.
 *
 * `interest` (ADR-0012 monetization signal, additive/optional) is passed
 * through unvalidated-but-schema-checked the same way `email` is: read off
 * the raw body, then only kept if it survives
 * `WaitlistSignupInputSchema.safeParse`. A missing or invalid value is
 * silently dropped (never a 400) so this stays a non-blocking signal, not a
 * new required field.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const raw: unknown = await request.json().catch(() => null);
  const email =
    typeof raw === "object" && raw !== null && "email" in raw
      ? (raw as { email: unknown }).email
      : undefined;
  const interest =
    typeof raw === "object" && raw !== null && "interest" in raw
      ? (raw as { interest: unknown }).interest
      : undefined;

  const parsed = WaitlistSignupInputSchema.safeParse({ email, source: "web", interest });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const apiBaseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/v1/waitlist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...(realIp ? { "x-real-ip": realIp } : {}),
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
  } catch {
    // Upstream unreachable (DNS, connection refused) — a retryable server
    // fault from the browser's point of view, never a 2xx.
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  const body: unknown = await res.json().catch(() => null);
  const response = NextResponse.json(body ?? {}, { status: res.status });
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) response.headers.set("retry-after", retryAfter);
  return response;
}
