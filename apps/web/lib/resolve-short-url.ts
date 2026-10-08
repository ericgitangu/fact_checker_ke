import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SHORTENER_HOSTS } from "./claim-source-detection";

/**
 * Best-effort shortener resolution for `/api/resolve-url`.
 *
 * SECURITY: this is a server-side fetch driven by user input (an SSRF
 * primitive), so every control below is load-bearing:
 *  - the INITIAL host must be in SHORTENER_HOSTS (allowlist);
 *  - redirects are followed MANUALLY so every hop is re-validated
 *    (http/https only, ports 80/443 only, host must not resolve to a
 *    private/loopback/link-local/metadata address);
 *  - GET + `Range: bytes=0-0` (HEAD stops at share.google's interstitial) and the
 *    body is cancelled unread;
 *  - at most MAX_REDIRECTS hops and one overall TIMEOUT_MS deadline;
 *  - ANY failure returns the original URL — never throws.
 *
 * Known residual risk (documented debt): the DNS check and the fetch's own
 * resolution are separate lookups, so a DNS-rebinding host could in theory
 * pass the check and then resolve privately. Mitigated (not eliminated) by the
 * allowlisted first hop + the fact that Cloud Run has no routable internal
 * network reachable by IP from the web tier; the real fix is pinning the
 * resolved IP via a custom undici dispatcher.
 */
export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 3000;

/** True for loopback, private, link-local (incl. 169.254.169.254), CGNAT, ULA, unspecified, multicast. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    // fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast)
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true; // not an IP at all -> treat as unsafe
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

function isSafeHop(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return false;
  if (url.username || url.password) return false;
  return true;
}

/** Canonicalise a YouTube watch URL to `watch?v=ID`, dropping tracking params (shem, si, feature, …). */
export function cleanResolvedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com" && url.pathname === "/watch") {
      const v = url.searchParams.get("v");
      if (v) return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export async function resolveShortUrl(
  original: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current: URL;
    try {
      current = new URL(original);
    } catch {
      return original;
    }
    if (!isSafeHop(current) || !SHORTENER_HOSTS.has(current.hostname.toLowerCase().replace(/^www\./, ""))) {
      return original;
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isSafeHop(current) || !(await hostIsPublic(current.hostname))) return original;

      const res = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { range: "bytes=0-0", "user-agent": "Mozilla/5.0 (compatible; fact_checker_ke/1.0)" },
        signal: controller.signal,
      });
      void res.body?.cancel().catch(() => undefined);

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      return cleanResolvedUrl(current.toString());
    }
    return original; // redirect budget exhausted
  } catch {
    return original;
  } finally {
    clearTimeout(timer);
  }
}
