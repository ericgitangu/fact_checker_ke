import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "./locale-switcher";

export async function AppHeader(): Promise<React.JSX.Element> {
  const t = await getTranslations("common");
  return (
    <header className="shell app-nav">
      <Link className="wordmark" href="/" aria-label={`${t("appName")} home`}>
        <span className="wordmark-mark" aria-hidden="true">
          fc
        </span>
        <span className="wordmark-text">{t("appName")}</span>
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
