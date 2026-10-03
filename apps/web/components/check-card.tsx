import type { Check } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { AwaitingEditorNotice, VerdictStamp } from "./verdict";

/**
 * The fact-check card — the one bold object on a check page, mirroring
 * apps/site's `.checkcard` sample. Renders the published verdict stamp, OR
 * (AT-0004-B) the explicit awaiting-editor state for a draft, never both,
 * never a placeholder stamp.
 */
export async function CheckCard({ check }: { check: Check }): Promise<React.JSX.Element> {
  const t = await getTranslations("check");

  return (
    <article className="checkcard" aria-label="Fact-check">
      {check.isDraft ? (
        <p className="checkcard-tag">{t("draft.pending")}</p>
      ) : (
        <p className="checkcard-tag">fact_checker_ke</p>
      )}

      <h1 className="checkcard-claim">{check.summary}</h1>

      {check.isDraft || !check.rating ? <AwaitingEditorNotice /> : <VerdictStamp rating={check.rating} />}

      <section aria-labelledby="claims-h">
        <h2 id="claims-h" className="sr-only">
          {t("claims.heading")}
        </h2>
        <ul className="source-list">
          {check.claims.map((claim) => (
            <li key={claim.id}>
              {claim.text}
              <span className="source-tier"> · {claim.claimType}</span>
            </li>
          ))}
        </ul>
      </section>

      <dl className="checkcard-meta">
        <div>
          <dt>{t("sources.heading")}</dt>
          <dd>
            <ul className="source-list">
              {check.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                  </a>
                  <span className="source-tier">{source.credibilityTier}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      {!check.isDraft && check.reviewedBy && (
        <p className="checkcard-rationale" style={{ marginTop: 16 }}>
          {t("reviewedBy")}
        </p>
      )}
    </article>
  );
}
