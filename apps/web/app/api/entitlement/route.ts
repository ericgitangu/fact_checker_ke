import { NextResponse, type NextRequest } from "next/server";
import { EntitlementSchema, NO_ENTITLEMENT } from "@fact-checker-ke/core";

/**
 * BFF proxy for ADR-0012 §3's `GET /v1/entitlement`. Same pattern as
 * api/device/route.ts — same-origin from the browser, forwards server-side
 * so `API_BASE_URL` stays out of the client bundle. The client sends its
 * device token as `X-Device-Token`; this route forwards ONLY that header
 * (never cookies or anything else) to the API.
 *
 * Fail-safe: any upstream failure returns the `NO_ENTITLEMENT` shape (ads
 * ON, no perks) with a 200, not a 5xx — the entitlement read is
 * best-effort UI state, and a backend blip must never flip a free reader
 * into a broken state or (worse) hide ads we should show. Never cached by
 * a shared CDN (per-reader data).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const deviceToken = request.headers.get("x-device-token");

  try {
    const res = await fetch(`${apiBaseUrl}/v1/entitlement`, {
      headers: deviceToken ? { "X-Device-Token": deviceToken } : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(NO_ENTITLEMENT, { status: 200, headers: { "cache-control": "private, no-store" } });
    }
    const body: unknown = await res.json();
    const parsed = EntitlementSchema.safeParse(body);
    return NextResponse.json(parsed.success ? parsed.data : NO_ENTITLEMENT, {
      status: 200,
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(NO_ENTITLEMENT, { status: 200, headers: { "cache-control": "private, no-store" } });
  }
}
