import { NextResponse } from "next/server";

/**
 * MOCK ONLY — dev-time stand-in for a signed GCS PUT URL (ADR-0027).
 * Drains and discards the request body; does NOT store, scan, or
 * EXIF-strip anything. Exists purely so the upload-progress UI in
 * lib/own-media-upload.ts (`putMedia`, XHR-based) has a real HTTP
 * endpoint to PUT against and gets real `upload.onprogress` events,
 * instead of a setTimeout-simulated fake progress bar.
 */
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<NextResponse> {
  // Draining the body is enough to let the browser report 100% upload
  // progress; we intentionally never persist it anywhere.
  await request.arrayBuffer().catch(() => null);
  return NextResponse.json({ ok: true, mock: true });
}
