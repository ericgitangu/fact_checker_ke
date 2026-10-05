import { NextResponse } from "next/server";
import { SubmissionStatusResponseSchema } from "@fact-checker-ke/core";

/**
 * BFF proxy for `GET /v1/submissions/:id` (ADR-0018), used by the
 * polling fallback in lib/submission-events.ts after 2 failed SSE
 * reconnects. Forwards `If-None-Match` so the 304 path (ADR-0018's cheap
 * "no change" response) survives the proxy hop.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const ifNoneMatch = request.headers.get("if-none-match");

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl}/v1/submissions/${encodeURIComponent(id)}`, {
      headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : undefined,
    });
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (upstream.status === 304) {
    return new NextResponse(null, { status: 304 });
  }
  if (upstream.status === 404) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "upstream_error", status: upstream.status }, { status: 502 });
  }

  const body: unknown = await upstream.json().catch(() => null);
  const parsed = SubmissionStatusResponseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "upstream_contract_error" }, { status: 502 });
  }

  const etag = upstream.headers.get("etag");
  return NextResponse.json(parsed.data, {
    status: 200,
    headers: etag ? { etag } : undefined,
  });
}
