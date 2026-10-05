import type { FeedItem } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { Reveal, RadarIcon } from "@fact-checker-ke/brand";
import { FeedItemCard } from "./feed-item-card";

/**
 * Feed-quality (virality): the "most viral right now" section — the top-3
 * PUBLISHED items by virality score (reach on the platforms we monitor),
 * rendered ABOVE the descending feed. Additive and fail-soft:
 *  - renders NOTHING when there is nothing viral (no empty state — the
 *    descending feed below owns the "nothing yet" message), so a site with no
 *    fetch-sourced items simply never shows this section;
 *  - degrades gracefully with fewer than 3 (shows 1 or 2);
 *  - reuses `FeedItemCard` verbatim (same row as the main feed — a claim must
 *    never read differently in the two sections), and the same list/reveal
 *    polish as `FeedSection`.
 *
 * The full legal disclosure is NOT repeated here — `FeedSection` renders it
 * once for the whole page, and these same items also appear in the descending
 * feed below, which that disclosure already covers.
 */
export async function ViralSection({ items }: { items: FeedItem[] }): Promise<React.JSX.Element | null> {
  if (items.length === 0) return null;
  const t = await getTranslations("feed");

  return (
    <section aria-labelledby="viral-heading" className="feed-section viral-section">
      <div className="feed-section-head">
        <h2 id="viral-heading" className="font-expanded viral-section-title">
          <RadarIcon size={20} aria-hidden />
          {t("viral.heading")}
        </h2>
        <p className="feed-section-intro">{t("viral.intro")}</p>
      </div>

      <ol className="feed-list viral-list">
        {await Promise.all(
          items.map(async (item: FeedItem, i: number) => (
            <li key={item.id}>
              <Reveal motion="rise" delay={Math.min(i, 4) * 0.06}>
                {await FeedItemCard({ item })}
              </Reveal>
            </li>
          )),
        )}
      </ol>
    </section>
  );
}
