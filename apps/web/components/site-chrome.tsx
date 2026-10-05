import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ExternalLinkIcon, Wordmark } from "@fact-checker-ke/brand";
import { LocaleSwitcher } from "./locale-switcher";
import { NavLink } from "./nav-link";
import { PrimaryNav } from "./primary-nav";
import { ThemeToggle } from "./theme-toggle";
import { BUY_ME_A_COFFEE_URL, GITHUB_REPO_URL, PATREON_URL } from "../lib/site";

export async function AppHeader(): Promise<React.JSX.Element> {
  const t = await getTranslations("common");
  return (
    <header className="shell app-nav">
      {/* Shared identity from @fact-checker-ke/brand: the FC·KE gradient
          mark, the "fact_checker_ke" text, and the superscript waving
          flag, identical to apps/site's nav — see
          packages/brand/README.md. The mark+text+flag are one unit inside
          <Wordmark> (the flag only renders alongside the text, as a
          trailing mark on the name), so this renders the whole lockup
          rather than compositing its own text span next to an icon-only
          mark. `t("appName")` still drives the Link's aria-label, so the
          accessible name stays translation-aware even though the visible
          brand name itself is untranslated (identical in every locale's
          message catalog). The Wordmark is rendered variant="light"
          deliberately: in dark mode globals.css flips just its text colour
          (:root[data-theme="dark"] .wordmark .fck-wordmark-text) while the
          gradient FC·KE mark and the flag read correctly on both grounds —
          so the one lockup follows the theme without needing a client
          boundary here. The light/dark toggle itself is <ThemeToggle/>
          below (brand's useTheme), added when apps/web became the sole
          frontend (ADR-0010/0015 amendments). */}
      <Link className="wordmark" href="/" aria-label={`${t("appName")} home`}>
        <Wordmark size="md" variant="light" />
      </Link>
      <PrimaryNav menuLabel={t("nav.menu")}>
        <NavLink href="/submit">{t("nav.submit")}</NavLink>
        <NavLink href="/feed">{t("nav.feed")}</NavLink>
        <NavLink href="/methodology">{t("nav.methodology")}</NavLink>
        <NavLink href="/maandamano">{t("nav.tracker")}</NavLink>
        {/* `/editor` is intentionally NOT linked here: it is an internal,
            authenticated-only surface (see app/editor/page.tsx), not a
            public destination. */}
        <LocaleSwitcher />
        {/* Light/dark toggle, carried over from the retired apps/site so the
            sole frontend keeps it — on every page via this shared header
            (ADR-0010/0015 amendments). */}
        <ThemeToggle />
      </PrimaryNav>
    </header>
  );
}

/**
 * Production footer (replaces the single-line "Terms & Privacy (pending
 * legal review)" stub that linked nowhere). Three real link groups —
 * Product, Project, Legal — every entry resolving to a real page, no
 * exceptions:
 *
 * - Product: the live product surfaces (Submit/Feed/Maandamano/Methodology),
 *   same destinations as the header nav.
 * - Project: `/join` ("how to join the movement") and `/contact` (the
 *   founder's contact card + downloadable vCard), plus an outbound link to
 *   the GitHub repo. Also carries the individual-supporter links (Buy Me a
 *   Coffee / Patreon) — distinct from <SponsorCta>'s org-focused ask — each
 *   rendered only when its env URL (`NEXT_PUBLIC_BUYMEACOFFEE_URL` /
 *   `NEXT_PUBLIC_PATREON_URL`, see lib/site.ts) is actually set, so an
 *   unconfigured channel never shows a dead placeholder link.
 * - Legal: `/terms` and `/privacy`. These ARE now linked even though
 *   `ADVOCATE_SIGNOFF_COMPLETE` (@fact-checker-ke/core) is still `false` —
 *   the pages themselves render a visible DRAFT badge and every
 *   `[ADVOCATE: ...]` open question (see app/terms|privacy/page.tsx), so
 *   publishing them as a readable draft (rather than hiding them behind a
 *   dead "pending review" label with no link) is the honest state: a real
 *   page you can read today, clearly marked as not yet legally binding.
 *   `ADVOCATE_SIGNOFF_COMPLETE` still gates search-engine indexing
 *   (`robots: noindex` on both pages) — only the *discovery-from-footer*
 *   gate is lifted here.
 */
export async function AppFooter(): Promise<React.JSX.Element> {
  const t = await getTranslations("common");
  const year = new Date().getUTCFullYear();

  return (
    <footer className="shell app-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <Link className="wordmark" href="/" aria-label={`${t("appName")} home`}>
            <Wordmark size="sm" variant="light" />
          </Link>
          <p className="footer-tagline">{t("footer.tagline")}</p>
          <div className="footer-meta">
            <span>{t("footer.languages")}</span>
            <span>{t("footer.builtIn")}</span>
          </div>
        </div>

        <div className="footer-groups">
          <div className="footer-col">
            <h2 className="footer-col-title">{t("footer.groupProduct")}</h2>
            <ul className="footer-links">
              <li>
                <Link href="/submit">{t("nav.submit")}</Link>
              </li>
              <li>
                <Link href="/feed">{t("nav.feed")}</Link>
              </li>
              <li>
                <Link href="/maandamano">{t("nav.tracker")}</Link>
              </li>
              <li>
                <Link href="/methodology">{t("nav.methodology")}</Link>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h2 className="footer-col-title">{t("footer.groupProject")}</h2>
            <ul className="footer-links">
              <li>
                <Link href="/join">{t("nav.join")}</Link>
              </li>
              <li>
                <Link href="/contact">{t("nav.contact")}</Link>
              </li>
              <li>
                <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
                  {t("footer.sourceLink")}
                  <ExternalLinkIcon size={12} aria-hidden="true" />
                </a>
              </li>
              {(BUY_ME_A_COFFEE_URL || PATREON_URL) && (
                <li className="footer-support">
                  <span className="footer-support-note">{t("footer.supportIntro")}</span>
                  <span className="footer-support-links">
                    {BUY_ME_A_COFFEE_URL && (
                      <a href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noreferrer noopener">
                        {t("footer.supportCoffee")}
                        <ExternalLinkIcon size={12} aria-hidden="true" />
                      </a>
                    )}
                    {PATREON_URL && (
                      <a href={PATREON_URL} target="_blank" rel="noreferrer noopener">
                        {t("footer.supportPatreon")}
                        <ExternalLinkIcon size={12} aria-hidden="true" />
                      </a>
                    )}
                  </span>
                </li>
              )}
            </ul>
          </div>

          <div className="footer-col">
            <h2 className="footer-col-title">
              {t("footer.groupLegal")}{" "}
              <span className="legal-draft-badge footer-legal-badge">
                {t("footer.legalPending")}
              </span>
            </h2>
            <ul className="footer-links">
              <li>
                <Link href="/terms">{t("nav.terms")}</Link>
              </li>
              <li>
                <Link href="/privacy">{t("nav.privacy")}</Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>{t("footer.rights", { year })}</p>
      </div>
    </footer>
  );
}
