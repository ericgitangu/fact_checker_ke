import { getTranslations } from "next-intl/server";
import { Reveal, ShieldCheckIcon, RadarIcon, ActivityIcon, EyeIcon } from "@fact-checker-ke/brand";

const FEATURES = [
  { key: "adFree", Icon: ShieldCheckIcon },
  { key: "alerts", Icon: RadarIcon },
  { key: "api", Icon: ActivityIcon },
  { key: "earlyAccess", Icon: EyeIcon },
] as const;

/**
 * ADR-0012 §3 payoff: the pre-launch Premium teaser. Pure signal, never a
 * checkout — the CTA anchors to the waitlist section below, where the
 * "I'd pay for Premium" option (`landing.waitlist.interest`) is the actual
 * capture mechanism. No price is shown because none is final; this is a
 * value-proposition preview, not a pricing page.
 *
 * Uses the same stamped "On the record" language as the hero sample
 * (`.verdict-stamp`'s tilt/weight) but in the dedicated `--premium` accent
 * so a paid tier never reads as a seventh verdict rating.
 */
export async function PremiumTeaser(): Promise<React.JSX.Element> {
  const t = await getTranslations("landing.premium");

  return (
    <section className="landing-premium" aria-labelledby="landing-premium-h">
      <Reveal className="premium-card" motion="rise" threshold={0.01}>
        <span className="premium-eyebrow">{t("eyebrow")}</span>
        <h2 id="landing-premium-h">{t("heading")}</h2>
        <p className="premium-body">{t("body")}</p>
        <ul className="premium-features">
          {FEATURES.map(({ key, Icon }) => (
            <li key={key}>
              <span className="premium-feature-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <div>
                <h3>{t(`features.${key}.title`)}</h3>
                <p>{t(`features.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="premium-actions">
          <a className="btn btn-primary" href="#waitlist">
            {t("cta")}
          </a>
          <p className="premium-note">{t("note")}</p>
        </div>
      </Reveal>
    </section>
  );
}
