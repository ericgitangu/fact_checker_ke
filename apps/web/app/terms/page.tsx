import type { Metadata } from "next";
import { ADVOCATE_SIGNOFF_COMPLETE, TERMS_SECTIONS } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";

// ADR-0033 AT-0033-2 deploy gate: this draft legal text must not be
// publicly indexed until a Kenyan advocate has signed off
// (`ADVOCATE_SIGNOFF_COMPLETE`, @fact-checker-ke/core). The page itself is
// linked from the footer's Legal column (components/site-chrome.tsx's
// `AppFooter`) and from the LegalCaveat component on every published
// check (right-of-reply purposes) — publishing it as a readable, visibly
// DRAFT page is the point; only search-engine indexing stays gated below.
export const metadata: Metadata = {
  title: "Terms & Conditions (draft) — fact_checker_ke",
  description:
    "DRAFT Terms & Conditions, pending a Kenyan advocate's review. Not yet legally binding.",
  robots: ADVOCATE_SIGNOFF_COMPLETE ? undefined : { index: false, follow: false },
};

/**
 * ADR-0033 §B / AT-0033-2: Terms & Conditions, rendered from the
 * `TERMS_SECTIONS` starter-draft data (`@fact-checker-ke/core`), gated as
 * visibly DRAFT. Every `[ADVOCATE: ...]` open question from the ADR
 * renders as a visible "pending legal review" marker (never silently
 * resolved into normal prose) — see the `legal.advocateMarker` label.
 *
 * Like `methodology/page.tsx`, the long-form legal body copy itself stays
 * English-only in this wave (editorial/legal translation review, not a
 * mechanical catalog entry); the page title, DRAFT badge, and the
 * advocate-marker label are translated via the `legal` i18n namespace.
 */
export default async function TermsPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("legal");

  return (
    <div className="shell-narrow flex flex-col gap-10">
      <div>
        <p className="legal-draft-badge">{t("pages.draftBadge")}</p>
        <h1>{t("pages.terms.title")}</h1>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>
          {t("pages.terms.intro")}
        </p>
      </div>

      {TERMS_SECTIONS.map((section, index) => (
        <section key={section.id} className="flex flex-col gap-3">
          <h2 style={{ fontSize: "1.2rem" }}>
            {index + 1}. {section.heading}
          </h2>
          <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>{section.body}</p>
          {"advocateMarker" in section && (
            <p className="legal-advocate-marker">
              <span className="sr-only">{t("advocateMarker")}: </span>
              {section.advocateMarker}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
