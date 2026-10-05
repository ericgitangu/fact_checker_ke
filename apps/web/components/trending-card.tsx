import type { TrendingItem } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { RadarIcon, EyeIcon, ExternalLinkIcon } from "@fact-checker-ke/brand";
import { TrendingStatusChip } from "./trending-status-chip";

/**
 * One row in the "Trending / under review" stream: a fetch-DISCOVERED viral
 * item. It shows ONLY the discovered video's own metadata (title, platform,
 * source link, reach) plus the derived tracking status — NEVER a held draft's
 * rating/summary/verdict (decision C: a draft is not public). This is NOT
 * `FeedItemCard`: that card renders a published check's verdict/confidence; a
 * trending item has no public verdict (it may have none yet, or a held one),
 * so it deliberately renders no rating.
 *
 * Lightweight by design (ADR-0035 owns heavy media embeds): the source video
 * is a plain `<a>` out to the platform, not an iframe.
 */
function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export async function TrendingCard({ item }: { item: TrendingItem }): Promise<React.JSX.Element> {
  const t = await getTranslations("feed");
  const observedDate = new Intl.DateTimeFormat("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(item.observedAt));

  return (
    <article className="trendingcard" aria-label={item.title}>
      <div className="trendingcard-head">
        <span className="ingest-badge ingest-badge-fetch">
          <span className="ingest-badge-icon" aria-hidden="true">
            <RadarIcon size={13} />
          </span>
          {t("source.fetch")}
        </span>
        {item.platform && <span className="platform-badge">{item.platform}</span>}
        {await TrendingStatusChip({ status: item.status })}
      </div>

      <p className="trendingcard-title">{item.title}</p>

      {item.engagement && (
        <p className="trendingcard-reach">
          <EyeIcon size={13} aria-hidden="true" />
          <span className="sr-only">{t("trending.reach")}: </span>
          {formatReach(item.engagement.views)}
        </p>
      )}

      <p className="trendingcard-meta">
        <time dateTime={item.observedAt}>{observedDate}</time>
        {item.sourceUrl && (
          <>
            {" · "}
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
              {t("trending.viewSource")}
              <ExternalLinkIcon size={12} aria-hidden="true" />
            </a>
          </>
        )}
        {/* A link to the public assessment ONLY when a published check exists.
            A held draft (under_review) exposes no checkId, so no link — its
            content is not public. */}
        {item.status === "published" && item.checkId && (
          <>
            {" · "}
            <a href={`/checks/${item.checkId}`}>{t("trending.viewCheck")}</a>
          </>
        )}
      </p>
    </article>
  );
}
