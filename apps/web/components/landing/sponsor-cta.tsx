import { getTranslations } from "next-intl/server";
import { ScaleIcon } from "@fact-checker-ke/brand";

/**
 * ADR-0012 §2 payoff + ADR-0030/creator-funnel-firewall framing: the
 * sponsor/partner block. Deliberately quieter than <PremiumTeaser> (no
 * stamp, no accent card) — this page spends its one unit of visual
 * boldness on the Premium teaser, not here, so a loud commercial surface
 * never competes with the "independent, open-source" trust positioning.
 *
 * The firewall line is not optional copy: sponsorship is framed as funding
 * independence, explicitly never influence over a verdict, matching
 * docs/architecture/creator-funnel-firewall.md's "revenue disclosure" and
 * "editorial independence" rules. The CTA anchors to the waitlist, where
 * "I represent an org interested in sponsorship" is the actual signal
 * capture — there is no separate intake form pre-launch.
 */
export async function SponsorCta(): Promise<React.JSX.Element> {
  const t = await getTranslations("landing.sponsor");

  return (
    <section className="sponsor" aria-labelledby="landing-sponsor-h">
      <p className="sponsor-eyebrow">{t("eyebrow")}</p>
      <h2 id="landing-sponsor-h">{t("heading")}</h2>
      <p className="sponsor-body">{t("body")}</p>
      <p className="sponsor-firewall">
        <ScaleIcon size={16} aria-hidden="true" />
        {t("firewall")}
      </p>
      <div className="sponsor-actions">
        <a className="btn btn-ghost" href="#waitlist">
          {t("cta")}
        </a>
      </div>
    </section>
  );
}
