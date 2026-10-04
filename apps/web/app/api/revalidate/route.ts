import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/** Constant-time secret comparison (same discipline as services/api/src/lib/auth/password.ts) -- a `!==` string compare on a shared secret is a timing side channel. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * ADR-0007 kill-switch mechanism — the "fast propagation" webhook
 * documented in docs/runbooks/nc4-kill-switch.md Step 2.2:
 *
 *   curl -X POST "$WEB_URL/api/revalidate?tag=maandamano&secret=$REVALIDATE_SECRET"
 *
 * Called by services/api right after an admin flips
 * `maandamano_kill_switch` (see
 * services/api/src/lib/maandamano-revalidate.ts), so apps/web's
 * ISR-cached `/maandamano` page (tag `"maandamano"`, see
 * app/maandamano/page.tsx) stops serving a pre-flip snapshot without
 * waiting out its normal revalidate window and without a redeploy.
 *
 * Secret-gated (`REVALIDATE_SECRET`, shared with services/api's
 * `REVALIDATE_SECRET` env var) rather than left open, since an
 * unauthenticated revalidate endpoint would let anyone force
 * regeneration of any tagged page on demand. Only `tag` is accepted (no
 * arbitrary `revalidatePath`) -- this endpoint exists for this one
 * mechanism, not as a general-purpose cache-buster.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expectedSecret = process.env.REVALIDATE_SECRET;
  const url = new URL(request.url);
  const providedSecret = url.searchParams.get("secret");
  const tag = url.searchParams.get("tag");

  if (!expectedSecret) {
    return NextResponse.json({ error: "revalidate_not_configured" }, { status: 503 });
  }
  if (!providedSecret || !secretsMatch(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!tag) {
    return NextResponse.json({ error: "missing_tag" }, { status: 400 });
  }

  // `{ expire: 0 }`, not the (deprecated, soon error-only) single-arg
  // form or `profile: "max"`: this call comes from a webhook, not a
  // Server Action, so `updateTag` isn't available here (Next 16 restricts
  // it to Server Actions) -- `{ expire: 0 }` is next/dist/docs's own
  // documented substitute for "the caller needs the data gone
  // immediately" from a Route Handler. A kill-switch flip is exactly
  // that: stale-while-revalidate ("max") would keep serving the
  // pre-flip page for up to a year while a background refetch catches up.
  revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ revalidated: true, tag }, { status: 200 });
}
