"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * ADR-0012 §4 (monetization v2): carries the AUTHORITATIVE, server-decided
 * "does this reader's region require consent?" flag from the server layout
 * (which reads `x-vercel-ip-country` — see lib/consent-region.ts) down to
 * the client consent hook (lib/consent.ts `useAdsConsent`).
 *
 * The value is `boolean | null`:
 *   - `true`/`false` — the server had a geo signal and decided.
 *   - `null`         — no server signal (local dev / non-Vercel host); the
 *     hook then falls back to the legacy client timezone heuristic so we
 *     never regress to "assume non-EEA" when geo is simply unavailable.
 *
 * Default is `null` (no provider mounted ⇒ behave exactly as before this
 * change), so the context is safe to read from any client component.
 */
const ServerConsentRegionContext = createContext<boolean | null>(null);

export function ConsentRegionProvider({
  serverRequired,
  children,
}: {
  serverRequired: boolean | null;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ServerConsentRegionContext.Provider value={serverRequired}>{children}</ServerConsentRegionContext.Provider>
  );
}

/** Reads the server-decided region flag; `null` when the server gave no signal. */
export function useServerConsentRegion(): boolean | null {
  return useContext(ServerConsentRegionContext);
}
