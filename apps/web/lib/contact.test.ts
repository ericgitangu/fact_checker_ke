import { describe, expect, it } from "vitest";
import { buildFounderVCard, FOUNDER_CONTACT } from "./contact";

/**
 * `buildFounderVCard` is the pure, environment-agnostic core of the
 * `/contact` download button (the DOM/Blob glue lives in
 * `app/contact/vcard-download-button.tsx`, deliberately untested here —
 * jsdom doesn't implement `URL.createObjectURL`). These assert the vCard
 * 3.0 payload contains exactly the verifiable details documented in
 * `FOUNDER_CONTACT`'s header comment, no more.
 */
describe("buildFounderVCard", () => {
  it("is a well-formed vCard 3.0 payload with CRLF line endings", () => {
    const vcard = buildFounderVCard();
    expect(vcard.startsWith("BEGIN:VCARD\r\n")).toBe(true);
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
    expect(vcard).toContain("VERSION:3.0\r\n");
  });

  it("contains the founder's verifiable name, title, email and location", () => {
    const vcard = buildFounderVCard();
    expect(vcard).toContain(`FN:${FOUNDER_CONTACT.name}`);
    expect(vcard).toContain(FOUNDER_CONTACT.professionalTitle);
    expect(vcard).toContain(`EMAIL;TYPE=INTERNET,PREF:${FOUNDER_CONTACT.email}`);
    expect(vcard).toContain(FOUNDER_CONTACT.locality);
    expect(vcard).toContain(FOUNDER_CONTACT.country);
  });

  it("contains the GitHub, LinkedIn and portfolio URLs, and no other contact method", () => {
    const vcard = buildFounderVCard();
    expect(vcard).toContain(FOUNDER_CONTACT.github);
    expect(vcard).toContain(FOUNDER_CONTACT.linkedin);
    expect(vcard).toContain(FOUNDER_CONTACT.site);
    // No invented phone number: vCard TEL property must never appear.
    expect(vcard).not.toContain("TEL");
  });

  it("never includes the founder's site's own malformed mailto value as the EMAIL property", () => {
    // developer.ericgitangu.com/contact literally renders
    // `mailto:developer.ericgitangu.com` (no "@") — that string must never
    // leak into the generated vCard's EMAIL line as if it were a real
    // address (the URL property legitimately links to that same domain).
    const vcard = buildFounderVCard();
    const emailLine = vcard.split("\r\n").find((line) => line.startsWith("EMAIL"));
    expect(emailLine).toBe(`EMAIL;TYPE=INTERNET,PREF:${FOUNDER_CONTACT.email}`);
    expect(emailLine).not.toContain("developer.ericgitangu.com");
  });
});
