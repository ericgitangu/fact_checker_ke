"use client";

import Script from "next/script";

/**
 * GA-4 (Google Analytics 4) with Consent Mode v2 — dependency-free (uses
 * next/script, no @next/third-parties), so it adds no package the day before a
 * launch and works regardless of Next's third-party-lib churn.
 *
 * ZERO-RISK NO-OP when unconfigured: renders nothing unless a non-empty
 * `measurementId` (NEXT_PUBLIC_GA_MEASUREMENT_ID) is set, so an unset env — the
 * default until the GA-4 property exists — ships no scripts at all.
 *
 * PRIVACY POSTURE (Consent Mode v2): `analytics_storage` defaults to DENIED in
 * consent regions (EEA/UK, decided server-side from the Vercel geo header — see
 * ConsentRegionProvider) and GRANTED elsewhere; ad_* signals are always denied
 * (this is analytics, not ads — the AdSense consent gate is separate). In a
 * consent region GA still loads but runs cookieless/pinged-only until a grant,
 * which is the compliant default for first-load analytics.
 */
export function GoogleAnalytics({
  measurementId,
  consentRequired,
}: {
  measurementId: string;
  consentRequired: boolean | null;
}): React.JSX.Element | null {
  if (!measurementId) return null;
  // null (no server geo signal: local dev / non-Vercel) is treated as
  // not-required, matching the ads hook's "never regress to assume-EEA" intent
  // for a tracking signal that is lower-risk than ad personalization.
  const analyticsDefault = consentRequired === true ? "denied" : "granted";

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{'analytics_storage':'${analyticsDefault}','ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied'});
gtag('js',new Date());
gtag('config','${measurementId}',{anonymize_ip:true});`}
      </Script>
    </>
  );
}
