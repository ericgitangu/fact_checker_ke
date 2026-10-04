import {
  STANDING_CAVEAT_SHORT,
  TIER_C_INLINE_CAVEAT,
  type RiskTier,
} from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";

/**
 * ADR-0033 §A/AT-0033-1: the standing caveat, rendered on every PUBLISHED
 * check (fetch- or submission-sourced, every tier) — see `check-card.tsx`,
 * which renders this only when `!check.isDraft`.
 *
 * The English body copy comes straight from `STANDING_CAVEAT_SHORT`
 * (`@fact-checker-ke/core`, the ADR-0033 one-source-string) rather than
 * the i18n catalog, matching the existing `methodology/page.tsx` precedent
 * of keeping long-form legal/editorial prose English-only until it gets
 * editorial translation review (see that page's i18n-gap comment) — but
 * the HEADING and the "this is a draft" / "read more" chrome ARE
 * translated via the `legal` i18n namespace, since those are UI labels,
 * not the legal text itself, and the task brief asked for i18n keys for
 * "the caveat" as a UI surface.
 *
 * `draftNotice` is rendered deliberately ABOVE the caveat body (not
 * hidden in a tooltip) per the task brief: this must not read as a
 * finished legal shield. ADR-0033 AT-0033-2's advocate-signoff gate
 * (`ADVOCATE_SIGNOFF_COMPLETE`, currently `false`) is reflected by this
 * notice always rendering for now — flipping the gate to serve this
 * caveat WITHOUT a draft marker is the advocate-led step this scaffolding
 * pass explicitly does not take.
 */
export async function LegalCaveat({
  riskTier,
}: {
  riskTier?: RiskTier | null;
}): Promise<React.JSX.Element> {
  const t = await getTranslations("legal");

  return (
    <section className="legal-caveat" aria-labelledby="legal-caveat-h">
      <p className="legal-draft-badge">{t("caveat.draftNotice")}</p>
      <h2 id="legal-caveat-h" className="legal-caveat-heading">
        {t("caveat.heading")}
      </h2>
      <p className="legal-caveat-body">{STANDING_CAVEAT_SHORT.body}</p>
      {riskTier === "C" && (
        <p className="legal-caveat-body" style={{ marginTop: 8, fontStyle: "italic" }}>
          <strong>{t("caveat.tierCNotice")}</strong> {TIER_C_INLINE_CAVEAT.body}
        </p>
      )}
      <p className="legal-caveat-body" style={{ marginTop: 8 }}>
        <a href="/terms">{t("caveat.readMore")}</a>
      </p>
    </section>
  );
}
