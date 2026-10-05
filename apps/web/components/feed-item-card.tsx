import type { FeedItem } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { ConfidenceGauge, RadarIcon, PenLineIcon } from "@fact-checker-ke/brand";
import { VerdictChip } from "./verdict";
import { FeedItemCaveatNote } from "./legal-caveat";
import { MarkdownText } from "./markdown-text";

/**
 * ADR-0032's visible payoff, rendered: one row in the "what we're
 * checking now" feed. Deliberately reuses the same primitives
 * `check-card.tsx` renders on a full check page (`VerdictChip` for the
 * rating, and the `check` namespace's confidence/claim-attributed copy)
 * rather than inventing a parallel rendering — a feed row and a check
 * page must never say two different things about the same published
 * assessment.
 *
 * The one thing a feed row adds that a check page doesn't need: the
 * ingest-source badge (AT-0032-6's provenance, made visible) — "Auto-
 * surfaced" (the fetch engine caught this trending) vs "Submitted" (a
 * reader sent it in). This is the whole point of this component: a
 * visitor should be able to tell, at a glance, that the product is
 * finding things on its own, not only waiting on submissions.
 *
 * Caveat: unlike `check-card.tsx`, this does NOT render the full
 * `LegalCaveat` per row — see `FeedItemCaveatNote`'s doc comment and
 * `feed-section.tsx`, which renders the full standing disclosure once,
 * for the whole list, rather than once per item.
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
          <span className="ingest-badge-icon" aria-hidden="true">
            {item.ingestSource === "fetch" ? <RadarIcon size={13} /> : <PenLineIcon size={13} />}
          </span>
          {t(`source.${item.ingestSource}`)}
        </span>
        {await VerdictChip({ rating: item.rating })}
        {item.calibratedConfidence !== null && (
          <ConfidenceGauge
            value={item.calibratedConfidence}
            label={tCheck("guidance.confidenceLabel")}
            size="sm"
            className="feedcard-gauge"
          />
        )}
      </div>

      <p className="feedcard-claim">
        <MarkdownText content={item.claim} inline />
      </p>

      {/* ADR-0034: lead the row with the context — what the claim asserts and
          how it misleads — so the feed explains, not just labels. */}
      {item.context && (
        <p className="feedcard-context">
          <MarkdownText content={item.context} inline />
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

      {await FeedItemCaveatNote({ riskTier: item.riskTier })}
    </article>
  );
}
