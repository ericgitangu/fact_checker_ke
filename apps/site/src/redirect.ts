/**
 * apps/site is retired to a redirect-only stub (ADR-0010/0015 amendments,
 * 2026-10-04). The marketing site was folded into the single frontend
 * (apps/web); this project now exists only so the old site URL keeps
 * working — every path 308-redirects to the web app.
 *
 * The AUTHORITATIVE redirect is the server-side `redirects` rule in
 * vercel.json (a 308 issued before any file is served). This module is the
 * belt-and-braces client fallback used by index.html's bundle, so a direct
 * document load still forwards even if the hosting redirect were ever
 * removed. The git history and the Vercel project itself are intentionally
 * preserved (retiring the project is the owner's call).
 */
export const WEB_URL = "https://fact-checker-ke-web.vercel.app";

/**
 * Maps a location on the old site to its equivalent on the web app,
 * preserving path, query and hash so deep links (e.g. /privacy, /?ref=x)
 * land on the same place. Pure and total so it can be unit-tested without a
 * DOM.
 */
export function redirectTarget(pathname: string, search = "", hash = ""): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${WEB_URL}${path}${search}${hash}`;
}
