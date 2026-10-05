import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Stagger, Reveal, VerdictScale, TwoEngineFlow } from "@fact-checker-ke/brand";
import { HeroSample } from "../components/landing/hero-sample";
import { PremiumTeaser } from "../components/landing/premium-teaser";
import { SponsorCta } from "../components/landing/sponsor-cta";
import { WaitlistForm } from "../components/waitlist-form";
import { FeedSection } from "../components/feed-section";
import { getFeedPage } from "../lib/get-feed";
import { buildScaleCopy, buildFlowCopy } from "../lib/brand-copy";

// A short preview (not the full paginated list — that's `/feed`), still
// live/fresh via the 30s revalidate on `getFeedPage`. On the landing this
// is the PROOF between the pitch and the scale: the fetch engine's visible
// payoff, immediately under the hero, not buried behind a nav click.
const HOME_PREVIEW_LIMIT = 4;

/**
 * The consolidated landing (ADR-0010/0015 amendments, 2026-10-04): the
 * marketing hero + value prop + waitlist that used to live in the retired
 * apps/site now open the single frontend, flowing straight into the live
 * product (the "what we're checking now" feed, the six-verdict scale, the
 * two-engine pipeline). The smart-input submit screen moved to `/submit`
 * (linked from the hero's primary CTA and the header) so `/` can lead with
 * the pitch.
 *
 * Every visual set piece is a shared @fact-checker-ke/brand component
 * (<VerdictScale>, <TwoEngineFlow>, <ConfidenceGauge> inside <HeroSample>,
 * <Reveal>/<Stagger>) rendered with the localised `brand` copy — the same
 * components the methodology page and the check page use — so there is no
 * duplicated design language, only page-level layout here.
 *
 * ADR-0012 monetization surface (2026-10-05): <PremiumTeaser> and
 * <SponsorCta> sit between the trust-building "principles" section and the
 * waitlist — pre-launch signal only, no checkout. Both CTAs anchor to
 * `#waitlist`, whose "which best describes you?" select is the actual
 * capture mechanism for willingness-to-pay / sponsorship interest.
 */
export default async function Home(): Promise<React.JSX.Element> {
  const t = await getTranslations("landing");
  const tb = await getTranslations("brand");
  const feed = await getFeedPage({ limit: HOME_PREVIEW_LIMIT });
  const scaleCopy = buildScaleCopy(tb);
  const flowCopy = buildFlowCopy(tb);

  return (
    <div className="shell landing-stack">
      <section className="landing-hero" aria-labelledby="landing-hero-h">
        <Stagger className="landing-hero-copy" motion="rise" step={0.09} threshold={0.01}>
          <h1 id="landing-hero-h">
            {t("hero.titleLine1")}
            <br />
            {t("hero.titleLine2")}
          </h1>
          <p className="landing-hero-lede">{t("hero.lede")}</p>
          <div className="landing-hero-actions">
            <Link className="btn btn-primary" href="/submit">
              {t("hero.ctaPrimary")}
            </Link>
            <Link className="btn btn-ghost" href="/methodology">
              {t("hero.ctaSecondary")}
            </Link>
            <a className="btn btn-ghost" href="#waitlist">
              {t("hero.ctaWaitlist")}
            </a>
          </div>
        </Stagger>
        <HeroSample />
      </section>

      <FeedSection items={feed.items} isMock={feed.isMock} showViewAllLink />

      <section aria-labelledby="landing-scale-h">
        <Reveal className="landing-section-intro" motion="rise">
          <h2 id="landing-scale-h">{t("scale.heading")}</h2>
          <p>{t("scale.body")}</p>
        </Reveal>
        <VerdictScale ariaLabel={tb("scale.ariaLabel")} verdicts={scaleCopy} />
      </section>

      <section aria-labelledby="landing-pipeline-h">
        <div className="landing-section-intro">
          <h2 id="landing-pipeline-h">{t("pipeline.heading")}</h2>
          <p>{t("pipeline.body")}</p>
        </div>
        <TwoEngineFlow ariaLabel={tb("flow.ariaLabel")} copy={flowCopy} />
      </section>

      <section className="street" aria-labelledby="landing-street-h">
        <div className="street-inner">
          <h2 id="landing-street-h">{t("street.heading")}</h2>
          <p>{t("street.body")}</p>
          <p className="street-note">{t("street.note")}</p>
          <Link className="landing-street-cta" href="/maandamano">
            {t("street.cta")}
          </Link>
        </div>
      </section>

      <section aria-labelledby="landing-principles-h">
        <div className="landing-section-intro">
          <h2 id="landing-principles-h">{t("principles.heading")}</h2>
        </div>
        <ul className="landing-principles-list">
          <li>
            <strong>{t("principles.independent.title")}</strong> {t("principles.independent.body")}
          </li>
          <li>
            <strong>{t("principles.cite.title")}</strong> {t("principles.cite.body")}
          </li>
          <li>
            <strong>{t("principles.audit.title")}</strong> {t("principles.audit.body")}
          </li>
          <li>
            <strong>{t("principles.reply.title")}</strong> {t("principles.reply.body")}
          </li>
        </ul>
        <Link className="landing-link" href="/methodology">
          {t("principles.link")}
        </Link>
      </section>

      <PremiumTeaser />

      <SponsorCta />

      <section id="waitlist" className="landing-waitlist" aria-labelledby="landing-waitlist-h">
        <div className="landing-section-intro">
          <h2 id="landing-waitlist-h">{t("waitlist.heading")}</h2>
          <p>{t("waitlist.body")}</p>
        </div>
        <WaitlistForm />
      </section>
    </div>
  );
}
