import { NextResponse } from "next/server";
import { RatingSchema } from "@fact-checker-ke/core";
import { z } from "zod";
import { EditorClient } from "../../../../../../lib/editor-client";

const CorrectBodySchema = z.object({
  rating: RatingSchema,
  summary: z.string().min(1).optional(),
});

/**
 * BFF proxy for the NOT-YET-IMPLEMENTED `POST /v1/editor/checks/:id/correct`.
 * Honest 501 when the backend isn't reachable/implemented — never a faked
 * success. See app/api/editor/drafts/route.ts (ADR-0020).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = CorrectBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: parsed.error.issues }, { status: 400 });
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const client = new EditorClient({ baseUrl: apiBaseUrl });

  try {
    await client.correct(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "editor_backend_unavailable", detail: "Editor corrections are not available yet (ADR-0020)." },
      { status: 501 },
    );
  }
}
