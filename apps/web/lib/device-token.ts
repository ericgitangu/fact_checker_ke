"use client";

/**
 * Anonymous device-token seam (ADR-0020 §1 / ADR-0018 AT-0018-8): fetches
 * and caches an opaque device token via the BFF proxy at `/api/device`
 * (which forwards to `POST /v1/device` server-side, same pattern as
 * `/api/submissions`), and sends it as `X-Device-Token` on submit and SSE
 * requests. services/api may not enforce this header yet — that is fine,
 * this is the client-side seam the backend agent wires enforcement into
 * later.
 *
 * Stored in localStorage (not a cookie) because it's read purely
 * client-side ahead of a fetch() call; this avoids sending it on every
 * same-origin request automatically, and avoids SSR cookie-parsing
 * complexity for an anonymous, non-security-critical token. Graceful SSR
 * handling: `getDeviceToken` is only ever invoked from "use client"
 * components, but guards `typeof window` anyway so an accidental
 * server-side import fails safely instead of throwing.
 */

const STORAGE_KEY = "fck_device_token_v1";

interface StoredToken {
  token: string;
  expiresAt: string;
}

function readStoredToken(): StoredToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      "expiresAt" in parsed &&
      typeof (parsed as StoredToken).token === "string" &&
      typeof (parsed as StoredToken).expiresAt === "string"
    ) {
      return parsed as StoredToken;
    }
    return null;
  } catch {
    // Corrupt or inaccessible storage (private browsing, quota) — treat as
    // "no token cached" rather than throwing.
    return null;
  }
}

function isExpired(expiresAt: string): boolean {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return true;
  // Refresh a little early to avoid a token expiring mid-request.
  return Date.now() > expiry - 30_000;
}

/**
 * Returns a cached, still-valid device token, or fetches a fresh one from
 * the BFF proxy. Returns `null` (rather than throwing) on fetch failure —
 * callers should treat a missing device token as "submit without it",
 * never as a hard blocker, since services/api does not enforce it yet.
 */
export async function getDeviceToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const cached = readStoredToken();
  if (cached && !isExpired(cached.expiresAt)) {
    return cached.token;
  }

  try {
    const res = await fetchImpl("/api/device", { method: "POST" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as StoredToken).token !== "string" ||
      typeof (body as StoredToken).expiresAt !== "string"
    ) {
      return null;
    }
    const next = body as StoredToken;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage write failure (quota, private mode) — still return the
      // freshly fetched token for this call, just don't cache it.
    }
    return next.token;
  } catch {
    return null;
  }
}
