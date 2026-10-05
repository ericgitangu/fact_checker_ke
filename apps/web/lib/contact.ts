import { GITHUB_REPO_URL } from "./site";

/**
 * Founder contact details for `/contact`, pulled verbatim from the
 * founder's own site (https://developer.ericgitangu.com) — specifically
 * its `schema.org/Person` JSON-LD block, which is site-authored
 * structured data, not a guess. Nothing here is invented: no phone number
 * is listed anywhere on that site, so none is included; the site's
 * `/contact` page also has a literally malformed `mailto:` link (missing
 * an `@`) which is NOT used as the email — the JSON-LD `email` field is
 * the one verifiable address.
 *
 * Deliberately a plain exported constant, not a schema/contract export —
 * this is a single person's public contact card, not product data.
 */
export const FOUNDER_CONTACT = {
  name: "Eric Gitangu",
  /** Verbatim `jobTitle` from developer.ericgitangu.com's Person JSON-LD. */
  professionalTitle: "Software Engineering Lead / Architect",
  locality: "Nairobi",
  country: "Kenya",
  /** Verbatim `email` from the same JSON-LD block. */
  email: "deveric@unicorns.run",
  github: "https://github.com/ericgitangu",
  githubHandle: "@ericgitangu",
  linkedin: "https://linkedin.com/in/ericgitangu",
  site: "https://developer.ericgitangu.com",
  repo: GITHUB_REPO_URL,
} as const;

function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/**
 * Builds a vCard 3.0 payload for `FOUNDER_CONTACT`. Pure and
 * environment-agnostic (no DOM/Blob APIs) so it is directly unit-testable;
 * the client component that triggers the browser download lives in
 * `contact-vcard-button.tsx`.
 */
export function buildFounderVCard(): string {
  const c = FOUNDER_CONTACT;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCardValue(c.name)};;;;`,
    `FN:${escapeVCardValue(c.name)}`,
    "ORG:fact_checker_ke",
    `TITLE:${escapeVCardValue(`Founder, fact_checker_ke — ${c.professionalTitle}`)}`,
    `EMAIL;TYPE=INTERNET,PREF:${c.email}`,
    `ADR;TYPE=WORK:;;;${escapeVCardValue(c.locality)};;;${escapeVCardValue(c.country)}`,
    `URL;TYPE=Portfolio:${c.site}`,
    `URL;TYPE=GitHub:${c.github}`,
    `URL;TYPE=LinkedIn:${c.linkedin}`,
    `NOTE:${escapeVCardValue(
      "Founder of fact_checker_ke, an independent, open-source fact-checking project for Kenya.",
    )}`,
    "END:VCARD",
  ];
  // vCard spec requires CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
