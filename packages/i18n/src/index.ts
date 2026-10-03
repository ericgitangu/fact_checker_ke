import en from "../messages/en.json" with { type: "json" };
import sw from "../messages/sw.json" with { type: "json" };

/**
 * ADR-0028: `packages/i18n` is the single source of truth for message
 * catalogs — `apps/web` consumes them via `next-intl`, a future
 * `apps/mobile` would consume the same JSON via `i18next`/`react-i18next`.
 * Namespaces: `check`, `tracker`, `editorial`, `common` (plus `submit`/
 * `status`, added here for the submit-to-status flow — same completeness
 * contract applies to every top-level namespace in the catalog).
 */
export const locales = ["en", "sw"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const messages = { en, sw } satisfies Record<Locale, unknown>;

export type Messages = typeof en;
