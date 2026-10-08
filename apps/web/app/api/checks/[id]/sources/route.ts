import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../../auth";

/**
 * BFF proxy for ADR-0038 Wave 2 `POST /v1/checks/:id/sources` ("Submit the
 * truth"). Same posture as api/submissions/route.ts: the browser posts here
 * same-origin, this forwards to services/api server-side, keeping API_BASE_URL
 * out of the client bundle. Forwards the `X-Device-Token` header (the API's
 * throttle key — ADR-0020 §1); services/api enforces the device token, the
 * lifecycle gate, dedup and tiering.
 *
 * The response body is passed through as-is on the API's success codes
 * (201 accepted/rejected, 200 duplicate) so the client renders the right ack;
 * the API's 4xx/5xx are mapped to a compact proxy status.
 */
const SourceBodySchema = z.object({
  url: z.string().url(),
  note: z.string().max(2000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Auth gate (server-side): add-source is one of the two gated actions.
  // 401 → the client routes the reader to /signin?callbackUrl=<current>.
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = SourceBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  }

  const deviceToken = request.headers.get("x-device-token");
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl}/v1/checks/${encodeURIComponent(id)}/sources`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(deviceToken ? { "x-device-token": deviceToken } : {}),
      },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  // Pass through the outcome body + status the client distinguishes on
  // (201 accepted/rejected, 200 duplicate, 404/409/429/501 handled client-side).
  const payload: unknown = await upstream.json().catch(() => ({}));
  return NextResponse.json(payload, { status: upstream.status });
}
