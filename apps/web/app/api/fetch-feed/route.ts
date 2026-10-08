import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { isPrivateAddress } from "../../../lib/resolve-short-url";

export const runtime = "nodejs";

/**
 * Egress proxy for public fact-check RSS feeds. The Python pipeline on Cloud
 * Run is 403-blocked by Cloudflare on pesacheck.org; Vercel's egress is not.
 *
 * SECURITY (server-side fetch driven by caller input = SSRF primitive; every
 * control is load-bearing, mirroring lib/resolve-short-url.ts):
 *  - HOST ALLOWLIST is the key control, enforced on the initial URL AND on every
 *    redirect hop (stricter than resolve-url: a feed may never bounce off-list);
 *  - redirects followed MANUALLY, <= MAX_REDIRECTS, each hop re-validated
 *    (http/https only, ports 80/443 only, no userinfo, host must not resolve to
 *    a private/loopback/link-local/metadata address);
 *  - one overall deadline (TIMEOUT_MS) covering headers AND body streaming;
 *  - body streamed and capped at MAX_BYTES, aborted when exceeded;
 *  - no auth: like /api/resolve-url, it relies on the allowlist, since only
 *    public RSS hosts can ever be fetched.
 *
 * Known residual risk (same as resolve-short-url, documented debt): the DNS
 * check and fetch's own resolution are separate lookups (DNS rebinding). The
 * allowlist bounds it to two hosts we expect to be public; the real fix is
 * pinning the resolved IP via a custom undici dispatcher.
 *
 * Failure contract: any failure -> non-2xx `{ error }` JSON; the caller fails
 * open ("feed unavailable"). Never hangs.
 */
export const FEED_HOSTS: ReadonlySet<string> = new Set(["pesacheck.org", "africacheck.org"]);
export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 8000;
export const MAX_BYTES = 3 * 1024 * 1024;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

class FeedError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const allowed of FEED_HOSTS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function isSafeHop(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return false;
  if (url.username || url.password) return false;
  return true;
}

async function hostIsPublic(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return !isPrivateAddress(bare);
  try {
    const addrs = await lookup(bare, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Read at most MAX_BYTES; throws FeedError("too_large") past the cap. */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    void res.body?.cancel().catch(() => undefined);
    throw new FeedError("too_large", 502);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new FeedError("too_large", 502);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function fetchFeed(raw: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  let current: URL;
  try {
    current = new URL(raw.trim());
  } catch {
    throw new FeedError("validation_error", 400);
  }
  if (!isSafeHop(current) || !isAllowedHost(current.hostname)) {
    throw new FeedError("host_not_allowed", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isSafeHop(current) || !isAllowedHost(current.hostname) || !(await hostIsPublic(current.hostname))) {
        throw new FeedError("blocked_hop", 502);
      }
      const res = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/rss+xml, application/xml, text/xml",
        },
        signal: controller.signal,
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        void res.body?.cancel().catch(() => undefined);
        try {
          current = new URL(location, current);
        } catch {
          throw new FeedError("blocked_hop", 502);
        }
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        void res.body?.cancel().catch(() => undefined);
        throw new FeedError("upstream_status", 502);
      }
      return await readCapped(res);
    }
    throw new FeedError("too_many_redirects", 502);
  } catch (err) {
    if (err instanceof FeedError) throw err;
    if (controller.signal.aborted) throw new FeedError("timeout", 504);
    throw new FeedError("fetch_failed", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function handle(url: unknown): Promise<NextResponse | Response> {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  try {
    const body = await fetchFeed(url, fetch);
    return new Response(body as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, s-maxage=300",
      },
    });
  } catch (err) {
    const e = err instanceof FeedError ? err : new FeedError("fetch_failed", 502);
    return NextResponse.json({ error: e.code }, { status: e.status, headers: { "cache-control": "no-store" } });
  }
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  return handle(new URL(request.url).searchParams.get("url"));
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  const body: unknown = await request.json().catch(() => null);
  const url = typeof body === "object" && body !== null && "url" in body ? (body as { url: unknown }).url : null;
  return handle(url);
}
