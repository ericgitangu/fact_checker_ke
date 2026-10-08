import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../../auth";

/**
 * BFF proxy for ADR-0038 Wave 2 `POST /v1/submissions/:id/sources` ("Submit the
 * truth" from a trending card). The public trending stream exposes `submissionId`
 * but never the draft check id, so a reader on a trending item submits by
 * submission id; services/api resolves it to the owning check. Same posture as
 * the /api/checks/:id/sources proxy — forwards the X-Device-Token server-side,
 * keeps API_BASE_URL out of the client bundle, passes the outcome body through.
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
    upstream = await fetch(`${apiBaseUrl}/v1/submissions/${encodeURIComponent(id)}/sources`, {
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

  const payload: unknown = await upstream.json().catch(() => ({}));
  return NextResponse.json(payload, { status: upstream.status });
}
