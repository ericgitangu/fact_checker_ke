import { NextResponse } from "next/server";
import { isShortenerUrl } from "../../../lib/claim-source-detection";
import { resolveShortUrl } from "../../../lib/resolve-short-url";

export const runtime = "nodejs";

/**
 * BFF: resolves an allowlisted link shortener (share.google, bit.ly, …) to
 * its destination so the submit form can recognise e.g. a YouTube video behind
 * a share.google link. Best-effort by contract — always 200 with
 * `{ resolvedUrl }`, falling back to the input on any failure. All SSRF
 * controls live in lib/resolve-short-url.ts.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const url =
    typeof body === "object" && body !== null && "url" in body
      ? (body as { url: unknown }).url
      : null;
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  // Allowlist gate (SSRF): only known shorteners are ever fetched server-side.
  if (!isShortenerUrl(url)) {
    return NextResponse.json({ error: "not_a_shortener" }, { status: 400 });
  }
  const resolvedUrl = await resolveShortUrl(url.trim());
  return NextResponse.json({ resolvedUrl });
}
