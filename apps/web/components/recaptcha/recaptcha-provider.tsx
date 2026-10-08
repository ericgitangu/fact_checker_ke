"use client";

import Script from "next/script";

/**
 * reCAPTCHA v3 script loader. Mounts the Google v3 API so useRecaptcha() can
 * later call grecaptcha.execute(). Dependency-free (next/script only — same
 * approach as components/analytics/google-analytics.tsx), so it adds no npm
 * package.
 *
 * ZERO-RISK NO-OP when unconfigured: renders nothing unless a non-empty
 * NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set, so an unset env — the default until the
 * reCAPTCHA keys exist — ships no script at all and useRecaptcha() returns null.
 *
 * BADGE / NOTICE: Google's terms require EITHER the floating reCAPTCHA badge OR
 * an equivalent text disclosure. This hides the badge and expects the host to
 * render <RecaptchaNotice /> somewhere on the page instead (see
 * components/recaptcha/recaptcha-notice.tsx) — hiding the badge WITHOUT that
 * notice would violate the terms. The <style> is global and intentionally
 * narrow (only `.grecaptcha-badge`).
 *
 * Mount once high in the tree (a layout or the specific form's page). It is a
 * leaf with no children by design — place it anywhere the forms render.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

const HIDE_BADGE_CSS = ".grecaptcha-badge{visibility:hidden !important;}";

export function RecaptchaProvider(): React.JSX.Element | null {
  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src={`https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`}
        strategy="afterInteractive"
      />
      {/* Compliant because <RecaptchaNotice /> carries the required disclosure. */}
      <style>{HIDE_BADGE_CSS}</style>
    </>
  );
}
