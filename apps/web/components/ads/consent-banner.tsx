"use client";

import { useTranslations } from "next-intl";
import { ADSENSE_CLIENT } from "../../lib/ads";
import { setConsent, useAdsConsent } from "../../lib/consent";

/**
 * ADR-0012 §4 — the EEA/UK consent banner (a lightweight CMP). Shows ONLY
 * when ads are configured AND the reader's region requires consent AND no
 * choice has been made yet (see lib/consent.ts `useAdsConsent`). "Decline"
 * is a first-class, equally-weighted action (never a dark-pattern buried
 * link) — declining stores the choice and permanently keeps ads off for
 * this reader, matching the repo's privacy posture (decline non-essential
 * by default).
 *
 * Renders nothing when ads are unconfigured, so — like every other ad
 * surface — it is invisible until the owner adds an AdSense account.
 */
export function ConsentBanner(): React.JSX.Element | null {
  const t = useTranslations("ads.consent");
  const { showBanner } = useAdsConsent();

  if (!ADSENSE_CLIENT) return null;
  if (!showBanner) return null;

  return (
    <div className="consent-banner" role="dialog" aria-modal="false" aria-label={t("title")}>
      <div className="consent-banner-body">
        <p className="consent-banner-title">{t("title")}</p>
        <p className="consent-banner-text">{t("body")}</p>
      </div>
      <div className="consent-banner-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setConsent("denied")}>
          {t("decline")}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setConsent("granted")}>
          {t("accept")}
        </button>
      </div>
    </div>
  );
}
