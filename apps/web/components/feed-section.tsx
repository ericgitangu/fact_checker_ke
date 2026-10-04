import type { FeedItem } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FeedItemCard } from "./feed-item-card";

/**
 * ADR-0032's visible payoff: the "what we're checking now" feed section,
 * shared between the home page (a short preview, `showViewAllLink`) and
 * `/feed` (the full list). `isMock` renders an honest, visible banner —
 * never silently presenting demo fixtures as live data (same convention
 * as `app/api/editor/drafts/route.ts`'s `_mock: true` tag) — and
 * `items.length === 0` on a REAL (non-mock) response renders the
 * deliberately honest empty state the task brief asked for, never fake
 * rows to fill the space.
 */
export async function FeedSection({
  items,
  isMock,
  showViewAllLink = false,
}: {
  items: FeedItem[];
  isMock: boolean;
  showViewAllLink?: boolean;
}): Promise<React.JSX.Element> {
  const t = await getTranslations("feed");

  return (
    <section aria-labelledby="feed-heading" className="feed-section">
      <div className="feed-section-head">
        <h2 id="feed-heading" className="font-expanded">
          {t("heading")}
        </h2>
        <p className="feed-section-intro">{t("intro")}</p>
        {isMock && <p className="legal-draft-badge">{t("mockNotice")}</p>}
      </div>

      {items.length === 0 ? (
        <p className="feed-empty" role="status">
          <strong>{t("empty.heading")}</strong>
          <br />
          {t("empty.body")}
        </p>
      ) : (
        <ul className="feed-list">
          {await Promise.all(
            items.map(async (item: FeedItem) => (
              <li key={item.id}>{await FeedItemCard({ item })}</li>
            )),
          )}
        </ul>
      )}

      {showViewAllLink && items.length > 0 && (
        <p className="feed-section-footer">
          <Link href="/feed">{t("viewAll")}</Link>
        </p>
      )}
    </section>
  );
}
