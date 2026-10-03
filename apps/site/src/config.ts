/**
 * Runtime configuration, validated once at module load.
 *
 * `import.meta.env.VITE_*` values are typed as `string` but are `undefined`
 * when unset; string-interpolating that into a URL yields a *relative* path
 * ("undefined/v1/waitlist") that silently hits the site's own origin. We
 * therefore require an absolute http(s) URL and surface misconfiguration as
 * its own state instead of a fake network error. Production builds also fail
 * fast in vite.config.ts.
 */
export type ApiConfig = { ok: true; apiUrl: string } | { ok: false; reason: string };

export function resolveApiUrl(raw: string | undefined): ApiConfig {
  if (!raw) return { ok: false, reason: "VITE_API_URL is not set" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "VITE_API_URL is not an absolute URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "VITE_API_URL must use http(s)" };
  }
  return { ok: true, apiUrl: url.origin + url.pathname.replace(/\/+$/, "") };
}
