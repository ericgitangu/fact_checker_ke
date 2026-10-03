import { NextResponse } from "next/server";
import { EditorClient } from "../../../../../../lib/editor-client";

/**
 * BFF proxy for the NOT-YET-IMPLEMENTED `POST /v1/editor/checks/:id/publish`.
 * See app/api/editor/drafts/route.ts for the same mock-fallback pattern —
 * here a failure (expected, route doesn't exist yet) still returns 200
 * with `_mock: true` so the dev-only editor UI can demonstrate the
 * approve flow end-to-end against fixture data.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new EditorClient({ baseUrl: apiBaseUrl });

  try {
    await client.publish(id);
    return NextResponse.json({ ok: true, _mock: false });
  } catch {
    return NextResponse.json({ ok: true, _mock: true });
  }
}
