import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExternalLinkIcon } from "@fact-checker-ke/brand";
import { FOUNDER_CONTACT } from "../../lib/contact";
import { VCardDownloadButton } from "./vcard-download-button";

export const metadata: Metadata = {
  title: "Contact — fact_checker_ke",
  description:
    "Reach the fact_checker_ke founder for press enquiries, corrections, right-of-reply requests, or partnership questions.",
};

/**
 * Real contact page (replaces the previous dead-end "Terms & Privacy
 * (pending legal review)" footer text with an actual reachable surface):
 * a contact card with the founder's publicly-listed details, plus a
 * downloadable vCard built client-side from the same data
 * (`vcard-download-button.tsx` / `lib/contact.ts`).
 *
 * Every detail on this page is pulled verbatim from
 * developer.ericgitangu.com's own `schema.org/Person` structured data
 * (name, title, email, Nairobi/Kenya location) plus its GitHub/LinkedIn
 * `sameAs` links — see `lib/contact.ts`'s header comment. No phone number
 * is shown because none is published there; nothing is invented.
 */
export default async function ContactPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("contact");
  const c = FOUNDER_CONTACT;

  return (
    <div className="shell-narrow flex flex-col gap-10">
      <div>
        <h1>{t("title")}</h1>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>
          {t("intro")}
        </p>
      </div>

      <div className="contact-card">
        <div className="contact-card-head">
          <h2 className="contact-card-name">{c.name}</h2>
          <p className="contact-card-role">{t("card.role")}</p>
        </div>

        <dl className="contact-card-facts">
          <div>
            <dt>{t("card.locationLabel")}</dt>
            <dd>{t("card.location")}</dd>
          </div>
          <div>
            <dt>{t("card.emailLabel")}</dt>
            <dd>
              <a href={`mailto:${c.email}`}>{c.email}</a>
            </dd>
          </div>
          <div>
            <dt>{t("card.linksLabel")}</dt>
            <dd className="contact-card-links">
              <a href={c.github} target="_blank" rel="noreferrer noopener">
                {t("card.github")}
                <ExternalLinkIcon size={12} aria-hidden="true" />
              </a>
              <a href={c.linkedin} target="_blank" rel="noreferrer noopener">
                {t("card.linkedin")}
                <ExternalLinkIcon size={12} aria-hidden="true" />
              </a>
              <a href={c.site} target="_blank" rel="noreferrer noopener">
                {t("card.site")}
                <ExternalLinkIcon size={12} aria-hidden="true" />
              </a>
            </dd>
          </div>
        </dl>

        <div className="contact-card-actions">
          <VCardDownloadButton label={t("card.download")} downloadedLabel={t("card.downloaded")} />
        </div>

        <p className="contact-card-source-note">{t("card.sourceNote")}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 style={{ fontSize: "1.2rem" }}>{t("rightOfReply.heading")}</h2>
        <p style={{ fontSize: "0.92rem", color: "var(--ink-2)" }}>{t("rightOfReply.body")}</p>
      </section>
    </div>
  );
}
