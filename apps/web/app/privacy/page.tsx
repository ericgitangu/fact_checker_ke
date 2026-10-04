import type { Metadata } from "next";
import { PRIVACY_SECTIONS } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { TrainingConsentToggle } from "./training-consent-toggle";

export const metadata: Metadata = {
  title: "Privacy Policy (draft) — fact_checker_ke",
  description:
    "DRAFT Privacy Policy, pending a Kenyan advocate's review. Not yet legally binding.",
};

/**
 * ADR-0033 §C / AT-0033-6: Privacy Policy, rendered from the
 * `PRIVACY_SECTIONS` starter-draft data (`@fact-checker-ke/core`), gated
 * as visibly DRAFT. The cross-border-transfer section renders the
 * ADR-0021 EU-processing disclosure verbatim (`EU_CROSS_BORDER_DISCLOSURE`,
 * snapshot-tested in `packages/core/src/__tests__/legal-caveat.test.ts`),
 * and the "what we collect" section renders the retention table mirroring
 * ADR-0021's retention classes. Every `[ADVOCATE: ...]` open question
 * renders as a visible marker, never silently resolved.
 */
export default async function PrivacyPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("legal");

  return (
    <div className="shell-narrow flex flex-col gap-10">
      <div>
        <p className="legal-draft-badge">{t("pages.draftBadge")}</p>
        <h1>{t("pages.privacy.title")}</h1>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>
          {t("pages.privacy.intro")}
        </p>
      </div>

      {PRIVACY_SECTIONS.map((section, index) => (
        <section key={section.id} className="flex flex-col gap-3">
          <h2 style={{ fontSize: "1.2rem" }}>
            {index + 1}. {section.heading}
          </h2>
          <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>{section.body}</p>

          {"retentionTable" in section && (
            <table style={{ width: "100%", fontSize: "0.88rem", borderCollapse: "collapse" }}>
              <caption className="sr-only">{t("pages.privacy.retentionHeading")}</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--rule-strong)",
                      color: "var(--ink)",
                    }}
                  >
                    {t("pages.privacy.dataClassColumn")}
                  </th>
                  <th
                    scope="col"
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--rule-strong)",
                      color: "var(--ink)",
                    }}
                  >
                    {t("pages.privacy.retentionColumn")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.retentionTable.map((row) => (
                  <tr key={row.dataClass}>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--rule)", color: "var(--ink-2)" }}>
                      {row.dataClass}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--rule)", color: "var(--ink-2)" }}>
                      {row.retentionDays === null
                        ? t("pages.privacy.indefinite")
                        : `${row.retentionDays} ${t("pages.privacy.daysSuffix")}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* AT-0033-3 / ADR-0021 AT-0021-6: the training-moat consent is a
              granular, severable, revocable TOGGLE, not just a paragraph —
              rendered directly under its own policy section, nowhere near
              the submit flow. See training-consent-toggle.tsx for the
              severability contract and this pass's honest scope note on
              what it does and does not wire up. */}
          {section.id === "training-moat-consent" && (
            <div>
              <TrainingConsentToggle />
            </div>
          )}

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
