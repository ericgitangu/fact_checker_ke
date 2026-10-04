/**
 * ADR-0007 kill-switch mechanism — "fast propagation" half. Flipping
 * `maandamano_kill_switch` (lib/maandamano.ts#setMaandamanoKillSwitch)
 * is audited and takes effect at the API layer immediately (`GET
 * /v1/maandamano` reads the flag fresh on every request, no API-side
 * cache). But apps/web's `/maandamano` page is ISR-cached (tag
 * `"maandamano"`, see apps/web/app/maandamano/page.tsx) so the CDN can
 * keep serving a pre-freeze page for up to its revalidate window unless
 * something purges that tag sooner — this is exactly red-team C-7
 * ("kill switch is leaky") from ADR-0007. This function calls apps/web's
 * `/api/revalidate` webhook (apps/web/app/api/revalidate/route.ts),
 * which calls Next's `revalidateTag("maandamano")`.
 *
 * Deliberately non-throwing: a failed/unconfigured webhook must NEVER
 * fail the kill-switch flip itself or roll back the audit log — the
 * flip's correctness (AT-0007-A's API-layer guarantee) does not depend
 * on this succeeding, only its SPEED of propagation to the CDN does.
 * The caller gets back whether it worked so it can surface that in the
 * response and the operator can cross-check with runbook Step 3.
 */
export interface MaandamanoRevalidateConfig {
  webBaseUrl: string | null;
  revalidateSecret: string | null;
}

export async function triggerMaandamanoRevalidation(
  config: MaandamanoRevalidateConfig,
  warn: (msg: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!config.webBaseUrl || !config.revalidateSecret) {
    warn(
      "WEB_BASE_URL/REVALIDATE_SECRET unset -- skipping the ISR revalidation webhook after a " +
        "maandamano_kill_switch flip. The flip is still enforced and audit-logged at the API layer, " +
        "but apps/web's /maandamano page may keep serving a stale (pre-flip) CDN-cached page until " +
        "its next natural ISR revalidation. Set both env vars so this webhook can run (see " +
        "docs/runbooks/nc4-kill-switch.md).",
    );
    return false;
  }

  const url = `${config.webBaseUrl.replace(/\/$/, "")}/api/revalidate?tag=maandamano&secret=${encodeURIComponent(
    config.revalidateSecret,
  )}`;

  try {
    const res = await fetchImpl(url, { method: "POST" });
    if (!res.ok) {
      warn(`ISR revalidation webhook responded ${res.status} -- /maandamano may serve a stale page until the next natural revalidation.`);
      return false;
    }
    return true;
  } catch (err) {
    warn(
      `ISR revalidation webhook request failed (${err instanceof Error ? err.message : String(err)}) -- ` +
        "/maandamano may serve a stale page until the next natural revalidation.",
    );
    return false;
  }
}
