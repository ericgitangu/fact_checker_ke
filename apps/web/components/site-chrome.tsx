import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@fact-checker-ke/brand";
import { LocaleSwitcher } from "./locale-switcher";

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
          message catalog). apps/web doesn't yet have a dark/light toggle
          (apps/site does, via its own useTheme), so variant is pinned to
          "light" rather than regressing to no theme at all; wiring up
          web-side dark mode is a separate, larger change tracked as
          follow-up, not bundled into this brand-parity fix. */}
      <Link className="wordmark" href="/" aria-label={`${t("appName")} home`}>
        <Wordmark size="md" variant="light" />
      </Link>
      <nav className="nav-links" aria-label="Primary">
        <Link href="/methodology">{t("nav.methodology")}</Link>
        <Link href="/maandamano">{t("nav.tracker")}</Link>
        <Link href="/editor">{t("nav.editor")}</Link>
        <LocaleSwitcher />
      </nav>
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
      </div>
    </footer>
  );
}
