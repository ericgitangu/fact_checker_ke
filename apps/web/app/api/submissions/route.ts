import { NextResponse } from "next/server";
import { ApiClient, ApiClientError, SubmissionInputSchema } from "@fact-checker-ke/core";

/**
 * BFF proxy: the browser posts here (same-origin, no CORS), and this route
 * forwards to services/api server-side. Keeps the API base URL out of the
 * client bundle and gives us one place to add auth/rate-limiting later.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = SubmissionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new ApiClient({ baseUrl: apiBaseUrl });

  try {
    const result = await client.submit(parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof ApiClientError) {
      return NextResponse.json({ error: "upstream_error", message: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
