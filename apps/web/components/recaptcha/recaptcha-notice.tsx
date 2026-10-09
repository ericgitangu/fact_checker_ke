import type { CSSProperties } from "react";

/**
 * The Google-REQUIRED reCAPTCHA disclosure, shown in place of the floating
 * badge that <RecaptchaProvider> hides. Rendering this (or the badge) is a
 * condition of Google's terms — do not hide the badge without it.
 *
 * Presentational and static (no "use client", no hook) so it can sit in a
 * server or client tree. Styled as a muted footnote using the site's EXISTING
 * theme tokens (the same --ink-3 body / --ink-2 link register as
 * .legal-caveat-body in app/globals.css) — no new palette, no AI-template look.
 * The tokens are CSS custom properties, so this flips with light/dark on its
 * own. `className` lets a form slot it into its own layout.
 */

const noticeStyle: CSSProperties = {
  fontSize: "0.82rem",
  lineHeight: 1.5,
  color: "var(--ink-3)",
};

const linkStyle: CSSProperties = {
  color: "var(--ink-2)",
  textUnderlineOffset: "3px",
};

export function RecaptchaNotice({ className }: { className?: string }): React.JSX.Element {
  return (
    <p className={className} style={noticeStyle}>
      This site is protected by reCAPTCHA and the Google{" "}
      <a
        href="https://policies.google.com/privacy"
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
      >
        Privacy Policy
      </a>{" "}
      and{" "}
      <a
        href="https://policies.google.com/terms"
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
      >
        Terms of Service
      </a>{" "}
      apply.
    </p>
  );
}
