/**
 * Early-adopter acknowledgement email — provider-agnostic renderer.
 *
 * Returns `{ subject, html, text }`; it does NOT send. Wire it to whichever
 * transport the signup handler uses (SMTP / Gmail API / Resend / ...).
 *
 * Palette is lifted from the site's own tokens (apps/web/app/globals.css,
 * light theme) and the brand package (packages/brand): paper/surface/ink
 * neutrals, the brand mark gradient endpoints, and — the distinctive part —
 * the six VERDICT colours, rendered as a segmented rule across the top and
 * as a small "how we rate" strip. The email thus carries the product's own
 * visual language (a verdict scale) rather than a generic marketing skin.
 *
 * Email-client constraints honoured: table layout, inline styles only, no
 * web fonts (stacks evoke the site's Bricolage Grotesque display / Newsreader
 * serif / Archivo body), 600px max, light theme only, bulletproof button,
 * hidden preheader, plain-text alternative.
 *
 * Content note: the product is NOT an IFCN signatory and this copy must
 * never imply accreditation.
 */

export type EarlyAdopterAckInput = {
  /** Full or first name as typed at signup. Optional. */
  name?: string;
  /** Absolute site origin. Defaults to the production site. */
  siteUrl?: string;
  /**
   * Absolute, publicly hosted PNG/JPG of the mark (NOT svg: Gmail and
   * Outlook strip/ignore SVG). Optional; the text wordmark always renders.
   */
  logoUrl?: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const DEFAULT_SITE_URL = "https://fact-checker-ke-web.vercel.app";
const FOUNDER_NAME = "Eric Gitangu";
const FOUNDER_EMAIL = "developer.ericgitangu@gmail.com";
const MAX_NAME_LEN = 40;

/** Brand tokens resolved to hex (globals.css light theme + brand-mark gradient). */
const C = {
  paper: "#fafaf7",
  paper2: "#f2f1ea",
  surface: "#ffffff",
  ink: "#15181b",
  ink2: "#585f66",
  ink3: "#696e74",
  rule: "#e4e3dc",
  ruleStrong: "#d2d0c6",
  brand: "#0d7c47", // --brand = --true (AA-corrected)
  brandTint: "#e7f2ec",
  gradA: "#17a862",
  gradB: "#2458d6",
  verdicts: [
    { label: "True", color: "#0d7c47" },
    { label: "Mostly true", color: "#577811" },
    { label: "Misleading", color: "#9c5e00" },
    { label: "False", color: "#c8102e" },
    { label: "Unproven", color: "#666c7a" },
    { label: "Not checkable", color: "#7860a1" },
  ],
} as const;

/** Email-safe stacks that echo the site's display / serif / body registers. */
const FONT_DISPLAY = `'Bricolage Grotesque','Trebuchet MS','Helvetica Neue',Helvetica,Arial,sans-serif`;
const FONT_SERIF = `Newsreader,Georgia,'Times New Roman',serif`;
const FONT_BODY = `Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif`;
const FONT_MONO = `'SFMono-Regular',Menlo,Consolas,'Courier New',monospace`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Accepts only absolute http(s) URLs; returns a normalised string or null. */
function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** First whitespace-delimited token, control chars stripped, length-capped. */
function firstName(raw: string | undefined): string | null {
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex -- deliberately stripping control chars from user input
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const token = cleaned.split(/\s+/)[0] ?? "";
  if (token.length === 0) return null;
  return token.slice(0, MAX_NAME_LEN);
}

function verdictRule(): string {
  const cells = C.verdicts
    .map(
      (v) =>
        `<td height="6" style="height:6px;line-height:6px;font-size:0;background-color:${v.color};" bgcolor="${v.color}">&nbsp;</td>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${cells}</tr></table>`;
}

function verdictChips(): string {
  // Two rows of three: survives narrow clients without wrapping glitches.
  const chip = (v: { label: string; color: string }): string =>
    `<td style="padding:0 14px 8px 0;font-family:${FONT_BODY};font-size:13px;line-height:18px;color:${C.ink2};white-space:nowrap;">` +
    `<span style="display:inline-block;width:9px;height:9px;background-color:${v.color};border-radius:2px;vertical-align:baseline;margin-right:7px;">&nbsp;</span>${escapeHtml(v.label)}</td>`;
  const rows = [C.verdicts.slice(0, 3), C.verdicts.slice(3, 6)]
    .map((row) => `<tr>${row.map(chip).join("")}</tr>`)
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

export function renderEarlyAdopterAckEmail(input: EarlyAdopterAckInput = {}): RenderedEmail {
  const siteUrl = (safeHttpUrl(input.siteUrl) ?? DEFAULT_SITE_URL).replace(/\/+$/, "");
  const logoUrl = safeHttpUrl(input.logoUrl);
  const first = firstName(input.name);

  const subject = "You're on the list: fact_checker_ke early access";
  const preheader =
    "Thanks for signing up. We'll email you once, when early access opens. No newsletter, no noise.";

  const greetingText = first ? `Hi ${first},` : "Hello,";
  const greetingHtml = first ? `Hi ${escapeHtml(first)},` : "Hello,";

  const paragraphs: readonly string[] = [
    "Thank you for signing up as an early adopter of fact_checker_ke. It means a lot, because a fact-checker is only useful if people who actually argue about claims in group chats and comment threads decide to use it.",
    "Here is what we are building: an autonomous fact-checker for the claims that go viral in Kenya. Every assessment is confidence-weighted and cited, so you can see how sure we are and where the evidence came from. We publish in English, Swahili and Sheng, and we rate claims, never people.",
    "What happens next: you will hear from us when early access opens, and not before. We will not add you to a newsletter or share your address.",
    "One honest note on credentials: fact_checker_ke is not an IFCN signatory. We would rather you judge us on the sources we show and the methodology we publish than on a badge.",
  ];

  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<tr><td style="padding:0 0 16px 0;font-family:${FONT_BODY};font-size:16px;line-height:25px;color:${C.ink};">${escapeHtml(p)}</td></tr>`,
    )
    .join("");

  const logoCell = logoUrl
    ? `<td valign="middle" style="padding:0 12px 0 0;"><img src="${escapeHtml(logoUrl)}" width="36" height="36" alt="fact_checker_ke" style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none;border-radius:8px;background-color:${C.ink};"></td>`
    : "";

  const ctaUrl = escapeHtml(siteUrl);
  const methodologyUrl = escapeHtml(`${siteUrl}/methodology`);

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.paper};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background-color:${C.paper};">
<tr><td align="center" style="padding:28px 12px;">
  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${C.surface};border:1px solid ${C.rule};border-radius:10px;border-collapse:separate;overflow:hidden;" bgcolor="${C.surface}">
    <tr><td style="padding:0;font-size:0;line-height:0;">${verdictRule()}</td></tr>

    <tr><td style="padding:26px 32px 0 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        ${logoCell}
        <td valign="middle" style="font-family:${FONT_DISPLAY};font-size:19px;line-height:24px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">
          <a href="${ctaUrl}" style="color:${C.ink};text-decoration:none;">fact_checker_ke</a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:30px 32px 6px 32px;font-family:${FONT_SERIF};font-size:30px;line-height:36px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">
      You're on the early-access list.
    </td></tr>
    <tr><td style="padding:0 32px 22px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="44" height="3" style="width:44px;height:3px;line-height:3px;font-size:0;background-color:${C.brand};" bgcolor="${C.brand}">&nbsp;</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:0 0 16px 0;font-family:${FONT_BODY};font-size:16px;line-height:25px;color:${C.ink};">${greetingHtml}</td></tr>
        ${bodyHtml}
      </table>
    </td></tr>

    <tr><td style="padding:8px 32px 26px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${C.brand}" style="background-color:${C.brand};border-radius:6px;">
          <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT_DISPLAY};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">See what we're building &rarr;</a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:0 32px 26px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background-color:${C.paper};border:1px solid ${C.rule};border-radius:8px;border-collapse:separate;">
        <tr><td style="padding:16px 18px 8px 18px;font-family:${FONT_MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${C.ink3};">How a claim is rated</td></tr>
        <tr><td style="padding:0 18px 4px 18px;">${verdictChips()}</td></tr>
        <tr><td style="padding:0 18px 16px 18px;font-family:${FONT_BODY};font-size:13px;line-height:20px;color:${C.ink2};">Six verdicts, each with a confidence level and its sources. <a href="${methodologyUrl}" style="color:${C.brand};text-decoration:underline;">Read the methodology</a>.</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 32px 30px 32px;font-family:${FONT_BODY};font-size:16px;line-height:25px;color:${C.ink};">
      Questions, or a claim you would like checked first? Just reply to this email. I read every one.
      <br><br>
      <span style="font-family:${FONT_SERIF};font-size:18px;font-style:italic;color:${C.ink};">${escapeHtml(FOUNDER_NAME)}</span><br>
      <span style="font-size:13px;line-height:20px;color:${C.ink2};">Founder, fact_checker_ke</span>
    </td></tr>

    <tr><td style="padding:0;border-top:1px solid ${C.rule};background-color:${C.paper2};" bgcolor="${C.paper2}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:18px 32px 22px 32px;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${C.ink3};">
        You're receiving this because you signed up for early access at fact_checker_ke (${ctaUrl}). We'll only email you about the launch. If this wasn't you, reply and we'll remove your address.<br>
        fact_checker_ke &middot; Kenya &middot; <a href="mailto:${escapeHtml(FOUNDER_EMAIL)}" style="color:${C.ink3};text-decoration:underline;">${escapeHtml(FOUNDER_EMAIL)}</a>
      </td></tr></table>
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    "fact_checker_ke",
    "",
    "You're on the early-access list.",
    "",
    greetingText,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `See what we're building: ${siteUrl}`,
    `How a claim is rated (True, Mostly true, Misleading, False, Unproven, Not checkable): ${siteUrl}/methodology`,
    "",
    "Questions, or a claim you would like checked first? Just reply to this email. I read every one.",
    "",
    FOUNDER_NAME,
    "Founder, fact_checker_ke",
    "",
    "--",
    `You're receiving this because you signed up for early access at fact_checker_ke (${siteUrl}). We'll only email you about the launch. If this wasn't you, reply and we'll remove your address.`,
    `fact_checker_ke | Kenya | ${FOUNDER_EMAIL}`,
    "",
  ].join("\n");

  return { subject, html, text };
}
