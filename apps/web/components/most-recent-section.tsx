import type { FeedItemView } from "../lib/lifecycle-read-model";
import { getLocale } from "next-intl/server";
import { Reveal, ActivityIcon } from "@fact-checker-ke/brand";
import { FeedItemCard } from "./feed-item-card";
import { homeRailRecentCopyFor } from "../lib/lifecycle-copy";

/**
 * ADR-0038 Wave 3 second highlight rail. The ADR asks for a "Most followed"
 * rail; there is NO `claim_follows` table yet (packages/db is fenced this
 * wave), so this FALLS BACK to "Most recent" ordering.
 *
 * FOLLOWS UPGRADE MARKER: when a `claim_follows` counter lands, (1) add a
 * `listHomeRailFollowed` repo read ordering by the counter, (2) surface it on
 * `GET /v1/feed/home` as a `mostFollowed` array, and (3) swap this rail's data +
 * heading (`homeRailRecentCopyFor` → a "Most followed" copy helper). The rail's
 * shape/placement here stays identical, so the upgrade is data-only.
 *
 * Mirrors `ViralSection` exactly (same `feed-section`/`viral-section` styling,
 * same `FeedItemCard` rows, same self-hiding-when-empty behaviour) so the two
 * rails read as one system — no new palette, per "reuse the design system".
 */
export async function MostRecentSection({ items }: { items: FeedItemView[] }): Promise<React.JSX.Element | null> {
  if (items.length === 0) return null;
  const locale = await getLocale();
  const copy = homeRailRecentCopyFor(locale);

  return (
    <section aria-labelledby="recent-heading" className="feed-section viral-section">
      <div className="feed-section-head">
        <h2 id="recent-heading" className="font-expanded viral-section-title">
          <ActivityIcon size={20} aria-hidden />
          {copy.heading}
        </h2>
        <p className="feed-section-intro">{copy.intro}</p>
      </div>

      <ol className="feed-list viral-list">
        {await Promise.all(
          items.map(async (item: FeedItemView, i: number) => (
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
