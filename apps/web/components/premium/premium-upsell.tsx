import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldCheckIcon } from "@fact-checker-ke/brand";

/**
 * ADR-0012 §3 — a tasteful Premium upsell entry. COMPLEMENTS the existing
 * monetization scaffolding, never duplicates it: the landing
 * <PremiumTeaser> is the full value-prop section, the footer carries the
 * individual-supporter links (Buy Me a Coffee / Patreon), and this is the
 * compact "go ad-free" nudge that can sit in the footer or inline next to
 * an ad. All three funnel to the SAME honest destination — the `#premium`
 * teaser → waitlist (interest=premium) — because checkout is a fail-closed
 * stub until the owner's PSP account exists (no "Buy now" button that 503s).
 *
 * Two variants:
 *   - `footer` — a quiet text link beside the supporter links.
 *   - `inline` — a small card shown under an in-article ad ("enjoying an
 *     ad-free-able read? go ad-free"), the contextual moment to upsell.
 */
export async function PremiumUpsell({
  variant = "inline",
}: {
  variant?: "footer" | "inline";
}): Promise<React.JSX.Element> {
  const t = await getTranslations("premium.upsell");

  if (variant === "footer") {
    return (
      <Link className="footer-premium-link" href="/#premium">
        <ShieldCheckIcon size={12} aria-hidden="true" />
        {t("footerCta")}
      </Link>
    );
  }

  return (
    <aside className="premium-upsell" aria-label={t("inlineTitle")}>
      <span className="premium-upsell-icon" aria-hidden="true">
        <ShieldCheckIcon size={16} />
      </span>
      <div className="premium-upsell-copy">
        <p className="premium-upsell-title">{t("inlineTitle")}</p>
        <p className="premium-upsell-body">{t("inlineBody")}</p>
      </div>
      <Link className="btn btn-ghost premium-upsell-cta" href="/#premium">
        {t("inlineCta")}
      </Link>
    </aside>
  );
}
