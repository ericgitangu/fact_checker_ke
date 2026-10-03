import { NextResponse } from "next/server";
import { ApiClient, ApiClientError, SubmissionInputSchema } from "@fact-checker-ke/core";

/**
 * BFF proxy: the browser posts here (same-origin, no CORS), and this route
 * forwards to services/api server-side. Keeps the API base URL out of the
 * client bundle and gives us one place to add auth/rate-limiting later.
 *
 * Forwards two client-set headers through to services/api, both part of
 * this wave's client-side seam (services/api may not enforce either yet):
 * - `X-Device-Token` (ADR-0020 §1 anonymous device token, see
 *   lib/device-token.ts) — identifies the submitting device without an
 *   account.
 * - `Idempotency-Key` (client-generated UUID per submit attempt, see
 *   submit-form.tsx) — lets a retried request after a network blip be
 *   deduplicated server-side instead of creating a second submission.
 *
 * `ApiClient` has no headers option, so we pass it a wrapped `fetchImpl`
 * that injects both headers onto the one request it makes, rather than
 * reimplementing the submit call by hand.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = SubmissionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const deviceToken = request.headers.get("x-device-token");
  const idempotencyKey = request.headers.get("idempotency-key");

  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({
    baseUrl: apiBaseUrl,
    fetchImpl: (input, init) => {
      const headers = new Headers(init?.headers);
      if (deviceToken) headers.set("X-Device-Token", deviceToken);
      if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
      return fetch(input, { ...init, headers });
    },
  });

  try {
    const result = await client.submit(parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof ApiClientError) {
      return NextResponse.json({ error: "upstream_error", message: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
