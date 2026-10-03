import { NextResponse } from "next/server";
import { EditorClient } from "../../../../lib/editor-client";
import { mockDraftChecks } from "../../../../fixtures/editor-drafts";

/**
 * BFF proxy for the NOT-YET-IMPLEMENTED `GET /v1/editor/drafts`
 * (see lib/editor-client.ts). Tries the real backend first; on any
 * failure (expected today — the route doesn't exist), falls back to the
 * local mock fixture and tags the response `_mock: true` so the editor UI
 * can render an honest "this is mock data" state instead of silently
 * presenting fixture rows as live drafts.
 */
export async function GET(): Promise<NextResponse> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new EditorClient({ baseUrl: apiBaseUrl });

  try {
    const drafts = await client.listDrafts();
    return NextResponse.json({ drafts, _mock: false });
  } catch {
    const drafts = mockDraftChecks.map((check) => ({
      check,
      submissionUrl: null,
      submissionText: null,
    }));
    return NextResponse.json({ drafts, _mock: true });
  }
}
