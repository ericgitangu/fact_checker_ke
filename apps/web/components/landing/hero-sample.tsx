"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfidenceGauge, ShieldCheckIcon, Reveal } from "@fact-checker-ke/brand";
import { TypedClaim } from "../typed-claim";

const SAMPLE_CONFIDENCE = 0.78;

/**
 * The hero's one bold object: a representative fact-check, shown rather than
 * described. Same stamped "On the record" language as the live check page
 * (.checkcard + .verdict + .v-<Rating> + the shared <ConfidenceGauge>), so
 * nothing about the brand language is re-invented for the landing.
 *
 * Client component because it owns the one orchestrated motion on the page:
 * the claim types itself out (<TypedClaim>), and only when it finishes does
 * the "Misleading" verdict press onto the record (`.stamp-ready`). Under
 * reduced motion both resolve instantly. Copy is localised (EN + SW) from
 * the `landing.sample` namespace.
 */
export function HeroSample(): React.JSX.Element {
  const t = useTranslations("landing.sample");
  const [claimTyped, setClaimTyped] = useState(false);

  return (
    <Reveal className="landing-sample" motion="press" delay={0.25} threshold={0.01}>
      <figure className="checkcard" aria-label={t("tag")}>
        <figcaption className="checkcard-tag">{t("tag")}</figcaption>
        <p className="checkcard-claim">
          <TypedClaim text={t("claim")} onDone={() => setClaimTyped(true)} />
        </p>
        <p className="checkcard-source-claim">{t("sourceClaim")}</p>
        <div className="verdict v-Misleading">
          <span className={`verdict-stamp landing-stamp${claimTyped ? " stamp-ready" : ""}`}>
            {t("verdict")}
          </span>
          <ConfidenceGauge
            value={SAMPLE_CONFIDENCE}
            label={t("confidenceLabel")}
            size="sm"
            className="checkcard-gauge"
          />
        </div>
        <p className="checkcard-rationale">{t("rationale")}</p>
        <dl className="checkcard-meta">
          <div>
            <dt>{t("sourcesLabel")}</dt>
            <dd>{t("sourcesValue")}</dd>
          </div>
          <div>
            <dt>{t("checkedInLabel")}</dt>
            <dd>
              <span className="lang-chip">English</span>
              <span className="lang-chip">Swahili</span>
            </dd>
          </div>
        </dl>
        <p className="checkcard-caveat">
          <ShieldCheckIcon size={15} />
          {t("caveat")}
        </p>
      </figure>
    </Reveal>
  );
}
