/**
 * ADR-0012 §4 (monetization v2) — the AUTHORITATIVE region decision, moved
 * server-side. The client timezone heuristic in lib/consent.ts was always
 * flagged as a stop-gap (see its scope note); this replaces it as the real
 * signal using the platform geo header.
 *
 * On Vercel, every request carries `x-vercel-ip-country` (an ISO-3166-1
 * alpha-2 code derived at the edge from the client IP — not spoofable by the
 * browser the way a timezone is). We read it server-side (layout.tsx) and
 * pass an authoritative "consent required?" flag down to the client banner,
 * which keeps rendering but no longer DECIDES the region itself.
 *
 * This module is framework-agnostic and pure (no "use client", no next/*
 * imports) so it unit-tests with no DOM and no request — the header read
 * itself lives in the server component.
 */

/**
 * Jurisdictions requiring prior opt-in consent before personalised ads
 * (GDPR/ePrivacy): the EU-27, the three non-EU EEA states (IS, LI, NO), and
 * the UK. ISO-3166-1 alpha-2, uppercase. Switzerland (CH) is deliberately
 * NOT included — its FADP is opt-OUT, not prior-consent — matching the
 * conservative-but-accurate scope the old heuristic aimed at.
 */
export const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  // EU-27
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA (non-EU)
  "IS", "LI", "NO",
  // UK
  "GB",
]);

/**
 * The authoritative decision: does a reader in `country` (an
 * `x-vercel-ip-country` value) require prior consent before ads load?
 *
 * Returns `null` when `country` is absent/blank — i.e. the platform gave us
 * no geo signal (local dev, a non-Vercel host, or an edge that didn't
 * resolve the IP). `null` means "server couldn't decide", NOT "no consent
 * needed" — the caller then falls back to the client heuristic rather than
 * silently assuming a non-EEA region. A present-but-unknown code resolves to
 * `false` (we have a signal and it isn't an EEA/UK country).
 */
export function countryRequiresConsent(country: string | null | undefined): boolean | null {
  if (country === null || country === undefined) return null;
  const code = country.trim().toUpperCase();
  if (code === "" || code === "XX") return null; // Vercel uses "XX"/empty when geo is unknown.
  return CONSENT_REQUIRED_COUNTRIES.has(code);
}
