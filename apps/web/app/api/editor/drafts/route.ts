import { NextResponse } from "next/server";
import { EditorClient } from "../../../../lib/editor-client";

/**
 * BFF proxy for the NOT-YET-IMPLEMENTED `GET /v1/editor/drafts`
 * (see lib/editor-client.ts). Tries the real backend; when it isn't
 * reachable/implemented, returns an honest 501 rather than fixture rows —
 * the /editor page is gated behind "sign-in required" until real editor
 * auth lands (ADR-0020), and this route must never serve mock drafts as
 * if they were live. The real path returns the backend's drafts verbatim
 * once /v1/editor/drafts exists.
 */
export async function GET(): Promise<NextResponse> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new EditorClient({ baseUrl: apiBaseUrl });

  try {
    const drafts = await client.listDrafts();
    return NextResponse.json({ drafts });
  } catch {
    return NextResponse.json(
      { error: "editor_backend_unavailable", detail: "Editor drafts are not available yet (ADR-0020)." },
      { status: 501 },
    );
  }
}
