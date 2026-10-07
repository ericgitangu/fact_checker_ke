import type { TrendingItem } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { Reveal, RadarIcon } from "@fact-checker-ke/brand";
import { TrendingCard } from "./trending-card";

/**
 * "Trending / under review" — the fetch engine's DISCOVERIES, surfaced so
 * "we catch what's trending" is visible immediately, regardless of publish
 * status. Rendered at the TOP of /feed (above "Most viral", which is
 * published-only). Additive and fail-soft:
 *  - renders NOTHING when there is nothing trending (self-hides, like
 *    `ViralSection`), so an instance with no fetch discoveries is unaffected;
 *  - degrades gracefully with any count;
 *  - leads with an honest note: these are items we're TRACKING, not verdicts;
 *    a status of "Under review" is a tracking state (a verdict is published
 *    only once an item clears review), NOT a promise that a human is actively
 *    assessing each one.
 *
 * It shows only each discovered video's own metadata + a tracking status — it
 * never renders a held draft's rating/summary (decision C).
 */
export async function TrendingSection({ items }: { items: TrendingItem[] }): Promise<React.JSX.Element | null> {
  if (items.length === 0) return null;
  const t = await getTranslations("feed");

  return (
    <section aria-labelledby="trending-heading" className="feed-section trending-section">
      <div className="feed-section-head">
        <h2 id="trending-heading" className="font-expanded viral-section-title">
          <RadarIcon size={20} aria-hidden />
          {t("trending.heading")}
        </h2>
        <p className="feed-section-intro">{t("trending.intro")}</p>
        <p className="trending-status-note">{t("trending.statusNote")}</p>
      </div>

      <ol className="feed-list trending-list">
        {await Promise.all(
          items.map(async (item: TrendingItem, i: number) => (
            <li key={item.submissionId}>
              <Reveal motion="rise" delay={Math.min(i, 4) * 0.06}>
                {await TrendingCard({ item })}
              </Reveal>
            </li>
          )),
        )}
      </ol>
    </section>
  );
}
