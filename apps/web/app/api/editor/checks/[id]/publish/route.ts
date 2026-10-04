import { NextResponse } from "next/server";
import { EditorClient } from "../../../../../../lib/editor-client";

/**
 * BFF proxy for the NOT-YET-IMPLEMENTED `POST /v1/editor/checks/:id/publish`.
 * Publishing is the highest-stakes editor action, so this route must NEVER
 * fake a success: an unreachable/unimplemented backend returns an honest
 * 501, not `{ ok: true }`. The real path forwards to the backend once
 * /v1/editor/checks/:id/publish exists (ADR-0020).
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
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "editor_backend_unavailable", detail: "Editor publish is not available yet (ADR-0020)." },
      { status: 501 },
    );
  }
}
