"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { locales, type Locale } from "@fact-checker-ke/i18n";

/**
 * ADR-0028: EN/SW only, no [locale]-prefixed routing — the locale is
 * stored in a plain cookie that apps/web/i18n/request.ts reads server-
 * side. Switching sets the cookie then refreshes the current route so
 * every server component re-renders with the new catalog.
 */
export function LocaleSwitcher(): React.JSX.Element {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <label>
      <span className="sr-only">{t("nav.language")}</span>
      <select className="locale-switch" value={locale} onChange={handleChange}>
        {locales.map((l: Locale) => (
          <option key={l} value={l}>
            {l === "en" ? "EN" : "SW"}
          </option>
        ))}
      </select>
    </label>
  );
}
