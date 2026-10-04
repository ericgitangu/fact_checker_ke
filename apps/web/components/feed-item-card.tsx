import type { FeedItem } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { VerdictChip } from "./verdict";
import { LegalCaveat } from "./legal-caveat";

/**
 * ADR-0032's visible payoff, rendered: one row in the "what we're
 * checking now" feed. Deliberately reuses the same primitives
 * `check-card.tsx` renders on a full check page (`VerdictChip` for the
 * rating, `LegalCaveat` for the standing caveat, and the `check`
 * namespace's confidence/claim-attributed copy) rather than inventing a
 * parallel rendering — a feed row and a check page must never say two
 * different things about the same published assessment.
 *
 * The one thing a feed row adds that a check page doesn't need: the
 * ingest-source badge (AT-0032-6's provenance, made visible) — "Auto-
 * surfaced" (the fetch engine caught this trending) vs "Submitted" (a
 * reader sent it in). This is the whole point of this component: a
 * visitor should be able to tell, at a glance, that the product is
 * finding things on its own, not only waiting on submissions.
 */
export async function FeedItemCard({ item }: { item: FeedItem }): Promise<React.JSX.Element> {
  const t = await getTranslations("feed");
  const tCheck = await getTranslations("check");
  const publishedDate = new Intl.DateTimeFormat("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(item.publishedAt));

  return (
    <article className="feedcard" aria-label={item.claim}>
      <div className="feedcard-head">
        <span className={`ingest-badge ingest-badge-${item.ingestSource}`}>
          {t(`source.${item.ingestSource}`)}
        </span>
        {await VerdictChip({ rating: item.rating })}
      </div>

      <p className="feedcard-claim">{item.claim}</p>

      {item.calibratedConfidence !== null && (
        <p className="checkcard-confidence">
          {tCheck("guidance.confidenceLabel")}: {Math.round(item.calibratedConfidence * 100)}%
        </p>
      )}

      <p className="checkcard-rationale">{tCheck("guidance.claimAttributedNote")}</p>

      {item.sources.length > 0 && (
        <section aria-labelledby={`feedcard-sources-${item.id}`}>
          <h3 id={`feedcard-sources-${item.id}`} className="sr-only">
            {tCheck("sources.heading")}
          </h3>
          <ul className="source-list">
            {item.sources.map((source) => (
              <li key={source.sourceId}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
                <span className="source-tier">{source.publisher}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="feedcard-meta">
        <time dateTime={item.publishedAt}>{publishedDate}</time>
        {" · "}
        <a href={`/checks/${item.id}`}>{t("viewCheck")}</a>
      </p>

      {await LegalCaveat({ riskTier: item.riskTier })}
    </article>
  );
}
