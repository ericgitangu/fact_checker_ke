import { useEffect } from "react";
import {
  ADVOCATE_SIGNOFF_COMPLETE,
  type PrivacySection,
  type TermsSection,
} from "@fact-checker-ke/core";
import { Wordmark, useTheme } from "@fact-checker-ke/brand";

type LegalSection = TermsSection | PrivacySection;

interface LegalPageProps {
  title: string;
  intro: string;
  sections: readonly LegalSection[];
}

/**
 * Shared renderer for /terms and /privacy. Reuses the SAME
 * `@fact-checker-ke/core` legal data apps/web renders (ADR-0033) so the
 * site and the app show identical legal text — no second copy to drift.
 *
 * DEPLOY-GATE (ADR-0033 AT-0033-2): while `ADVOCATE_SIGNOFF_COMPLETE` is
 * `false`, this page sets `<meta name="robots" content="noindex,nofollow">`
 * and is never linked from the site's nav/footer (see App.tsx and
 * main.tsx's router) — direct-link only, visibly marked DRAFT below.
 */
export function LegalPage({ title, intro, sections }: LegalPageProps): React.JSX.Element {
  const [theme] = useTheme();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} (draft) — fact_checker_ke`;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    const previousContent = meta.content;
    // ADR-0033 AT-0033-2: draft legal text stays out of search results
    // until an advocate signs off, regardless of hosting-layer SEO config.
    meta.content = ADVOCATE_SIGNOFF_COMPLETE ? "index,follow" : "noindex,nofollow";

    return () => {
      document.title = previousTitle;
      if (createdMeta) {
        meta?.remove();
      } else {
        meta!.content = previousContent;
      }
    };
  }, [title]);

  return (
    <>
      <header className="nav">
        <a className="wordmark" href="#top" aria-label="fact_checker_ke home">
          <Wordmark size="md" variant={theme} />
        </a>
      </header>
      <main id="top" className="legal-page">
        <p className="legal-draft-badge">
          Draft &mdash; pending a Kenyan advocate&rsquo;s review. Not yet legally binding.
        </p>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>

        {sections.map((section, index) => (
          <section key={section.id} className="legal-section">
            <h2>
              {index + 1}. {section.heading}
            </h2>
            {section.body && <p>{section.body}</p>}

            {"retentionTable" in section && (
              <table className="legal-retention-table">
                <caption className="sr-only">Data retention by class</caption>
                <thead>
                  <tr>
                    <th scope="col">Data class</th>
                    <th scope="col">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {section.retentionTable.map((row) => (
                    <tr key={row.dataClass}>
                      <td>{row.dataClass}</td>
                      <td>{row.retentionDays === null ? "Indefinite" : `${row.retentionDays} days`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {"advocateMarker" in section && (
              <p className="legal-advocate-marker">
                <span className="sr-only">Pending legal review: </span>
                {section.advocateMarker}
              </p>
            )}
          </section>
        ))}

        <p className="legal-back">
          <a href="/">&larr; Back to fact_checker_ke</a>
        </p>
      </main>
    </>
  );
}
