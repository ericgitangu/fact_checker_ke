/**
 * SSE passthrough proxy for `GET /v1/submissions/:id/events` (ADR-0018).
 *
 * DESIGN CHOICE (documented per the task brief): `EventSource` must run
 * client-side, and a cross-origin `EventSource` to services/api directly
 * would require services/api to send CORS headers — but services/api is
 * owned by a different concurrent agent in this wave and is explicitly
 * out of this agent's file ownership, so we cannot add CORS there. This
 * route instead proxies the stream through apps/web's own origin (same
 * pattern as the existing `/api/submissions` POST and the new
 * `/api/submissions/[id]` GET above), so the browser's `EventSource`
 * talks same-origin and no CORS configuration is needed on services/api
 * at all. The trade-off: this Next.js server instance holds the stream
 * open for its duration (same cost shape ADR-0018 already accepts for the
 * Cloud Run API itself — bounded by the API's own 90s cap, which this
 * proxy inherits because it simply relays the upstream response).
 *
 * Forwards `Last-Event-ID` for resume (ADR-0018 point 3) and streams the
 * upstream body through untouched (no buffering) so heartbeats and
 * individual `data:` frames arrive to the client as emitted.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8080";
  const lastEventId = request.headers.get("last-event-id");

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl}/v1/submissions/${encodeURIComponent(id)}/events`, {
      headers: {
        accept: "text/event-stream",
        ...(lastEventId ? { "last-event-id": lastEventId } : {}),
      },
    });
  } catch {
    return new Response("event: error\ndata: upstream_unreachable\n\n", {
      status: 502,
      headers: { "content-type": "text/event-stream" },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`event: error\ndata: upstream_status_${upstream.status}\n\n`, {
      status: upstream.status === 404 ? 404 : 502,
      headers: { "content-type": "text/event-stream" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
