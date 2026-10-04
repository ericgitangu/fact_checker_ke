import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ADVOCATE_SIGNOFF_COMPLETE } from "@fact-checker-ke/core";
import { Wordmark } from "@fact-checker-ke/brand";
import { LocaleSwitcher } from "./locale-switcher";
import { PrimaryNav } from "./primary-nav";
import { ThemeToggle } from "./theme-toggle";

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
        <Link href="/submit">{t("nav.submit")}</Link>
        <Link href="/feed">{t("nav.feed")}</Link>
        <Link href="/methodology">{t("nav.methodology")}</Link>
        <Link href="/maandamano">{t("nav.tracker")}</Link>
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

export async function AppFooter(): Promise<React.JSX.Element> {
  const t = await getTranslations("common");
  return (
    <footer className="shell app-footer">
      <p>{t("footer.tagline")}</p>
      <div style={{ display: "flex", gap: 24 }}>
        <span>{t("footer.languages")}</span>
        <span>{t("footer.builtIn")}</span>
        {/* ADR-0033 AT-0033-2 deploy gate: the Terms/Privacy pages are
            draft legal copy pending a Kenyan advocate's sign-off
            (`ADVOCATE_SIGNOFF_COMPLETE`, @fact-checker-ke/core). Until
            that flips, they're removed from this primary discovery path
            (and noindex'd — see app/terms|privacy/page.tsx) rather than
            linked as if they were finished policy; a plain-text
            "pending review" stub replaces the links so the footer stays
            honest about why they're missing instead of silently
            dropping the row. */}
        {ADVOCATE_SIGNOFF_COMPLETE ? (
          <>
            <Link href="/terms">{t("nav.terms")}</Link>
            <Link href="/privacy">{t("nav.privacy")}</Link>
          </>
        ) : (
          <span className="legal-draft-badge">{t("footer.legalPending")}</span>
        )}
      </div>
    </footer>
  );
}
