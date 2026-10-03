import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * BFF proxy for the NOT-YET-IMPLEMENTED ADR-0027 `POST /v1/uploads/slot`
 * (signed direct-to-GCS upload URL issuance). services/api has no upload
 * routes yet. AT-0027-1 ("no rights attestation -> rejected before a
 * signed URL is issued") is enforced HERE even in the mock path, since
 * that's a policy the client seam should never silently skip, real
 * backend or not.
 *
 * Falls back to a same-origin mock PUT target
 * (/api/uploads/mock-put/:assetId) so the upload-progress UI in dev
 * exercises a real HTTP PUT with real XHR progress events — the mock
 * route just drains and discards the body; nothing is scanned, stored,
 * or EXIF-stripped, because none of that infrastructure exists yet. The
 * UI surfaces this plainly (see components/submit/media-dropzone.tsx's
 * trust note).
 */
const SlotRequestSchema = z.object({
  filename: z.string().min(1).max(500),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  rightsAttested: z.literal(true),
});

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = SlotRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Covers AT-0027-1: rightsAttested !== true fails `z.literal(true)`
    // and lands here as a 400, before any upload URL (mock or real) is
    // issued.
    return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  try {
    const upstream = await fetch(`${apiBaseUrl}/v1/uploads/slot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    if (upstream.ok) {
      const data = (await upstream.json()) as { uploadUrl: string; assetId: string };
      return NextResponse.json({ ...data, mock: false });
    }
  } catch {
    // Expected today — fall through to the mock below.
  }

  const assetId = crypto.randomUUID();
  return NextResponse.json({
    uploadUrl: `/api/uploads/mock-put/${assetId}`,
    assetId,
    mock: true,
  });
}
