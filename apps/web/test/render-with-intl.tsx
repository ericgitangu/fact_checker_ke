import type { ReactElement, ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { render, type RenderResult } from "@testing-library/react";
import { messages, type Locale } from "@fact-checker-ke/i18n";

/**
 * Wraps a tree with the REAL `@fact-checker-ke/i18n` catalog via next-intl's
 * client provider — the same provider apps/web/app/layout.tsx mounts at the
 * root in production. Client components under test (SubmitForm, the submit/*
 * widgets, StatusTracker, LocaleSwitcher, EditorDraftsPanel) use `useTranslations`
 * from plain `next-intl`, which reads this context; no mocking involved.
 */
export function IntlProviderHarness({
  children,
  locale = "en",
}: {
  children: ReactNode;
  locale?: Locale;
}): ReactElement {
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithIntl(ui: ReactElement, locale: Locale = "en"): RenderResult {
  return render(<IntlProviderHarness locale={locale}>{ui}</IntlProviderHarness>);
}
