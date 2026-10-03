import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, locales, messages, type Locale } from "@fact-checker-ke/i18n";

/**
 * ADR-0028: EN/SW only. We deliberately do NOT use next-intl's
 * [locale]-prefixed routing (it would force restructuring every existing
 * app route under apps/web/app/[locale]/...) — instead the locale lives in
 * a plain cookie, set by components/locale-switcher.tsx, and read here on
 * every request. This is the "simpler approach that doesn't force a route
 * restructure" the brief asks for; the trade-off is no locale-specific
 * URLs (no SEO-indexable /sw/checks/:id) — acceptable for Phase 0-1 per
 * ADR-0028's own scope note that Sheng/SW is EN+SW chrome only, not a
 * routing concern.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value;
  const locale: Locale = (locales as readonly string[]).includes(cookieLocale ?? "")
    ? (cookieLocale as Locale)
    : defaultLocale;

  return {
    locale,
    messages: messages[locale],
  };
});
