import { NextResponse } from "next/server";
import { DeviceTokenResponseSchema } from "@fact-checker-ke/core";

/**
 * BFF proxy for ADR-0020 §1's anonymous device token: `POST /v1/device`.
 * Same pattern as api/submissions/route.ts — same-origin from the
 * browser, forwards server-side, keeps API_BASE_URL out of the client
 * bundle. services/api may not implement `/v1/device` yet; a non-2xx or
 * network failure here is surfaced as a plain 502 and the client-side
 * device-token helper (lib/device-token.ts) treats that as "no token",
 * not a hard failure.
 */
export async function POST(): Promise<NextResponse> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";

  try {
    const res = await fetch(`${apiBaseUrl}/v1/device`, { method: "POST" });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_error", status: res.status }, { status: 502 });
    }
    const body: unknown = await res.json();
    const parsed = DeviceTokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "upstream_contract_error" }, { status: 502 });
    }
    return NextResponse.json(parsed.data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }
}
