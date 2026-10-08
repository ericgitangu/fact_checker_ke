import { Fragment } from "react";
import type { FeedItemView } from "../lib/lifecycle-read-model";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Reveal, RadarIcon } from "@fact-checker-ke/brand";
import { EmptyState, type EmptyStateAction } from "./empty-state";
import { FeedItemCard } from "./feed-item-card";
import { LegalCaveat } from "./legal-caveat";
import { AdSlot } from "./ads/ad-slot";
import { IN_FEED_AD_AFTER } from "../lib/ads";

/**
 * ADR-0032's visible payoff: the "what we're checking now" feed section,
 * shared between the home page (a short preview, `showViewAllLink`) and
 * `/feed` (the full list). `isMock` renders an honest, visible banner —
 * never silently presenting demo fixtures as live data (same convention
 * as `app/api/editor/drafts/route.ts`'s `_mock: true` tag) — and
 * `items.length === 0` on a REAL (non-mock) response renders the
 * deliberately honest empty state the task brief asked for, never fake
 * rows to fill the space.
 *
 * Legal caveat, collapsed: each `FeedItemCard` row carries only the short
 * `FeedItemCaveatNote`, not the full ADR-0033 standing disclosure — that
 * would repeat the same draft-badge/full-body/Terms-link block under
 * every row in the list. The FULL disclosure renders exactly ONCE here,
 * after the list, covering every item above it (`disclosureIntro` says
 * so explicitly) — still fully visible, just not N times over.
 */
export async function FeedSection({
  items,
  isMock,
  showViewAllLink = false,
  emptyAction,
}: {
  items: FeedItemView[];
  isMock: boolean;
  showViewAllLink?: boolean;
  /** Only the full `/feed` route passes this — the home-page preview
      already sits on "home", so it has nothing useful to link the empty
      state's action to. */
  emptyAction?: EmptyStateAction;
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
        <EmptyState
          icon={<RadarIcon size={22} />}
          title={t("empty.heading")}
          description={t("empty.body")}
          action={emptyAction}
        />
      ) : (
        <ul className="feed-list">
          {await Promise.all(
            items.map(async (item: FeedItemView, i: number) => {
              // ADR-0012 §4: in-feed ad unit AFTER item N — between whole
              // cards (never above the fold, never between a claim and its
              // evidence). Its own <li> so the list stays valid. Renders
              // nothing until the owner configures AdSense, and nothing for
              // Premium (ad-free) readers. Only on the full /feed list, not
              // the short home-page preview (`showViewAllLink`).
              const showAdAfter =
                !showViewAllLink && i === IN_FEED_AD_AFTER - 1 && items.length > IN_FEED_AD_AFTER;
              return (
                <Fragment key={item.id}>
                  <li>
                    <Reveal motion="rise" delay={Math.min(i, 4) * 0.06}>
                      {await FeedItemCard({ item })}
                    </Reveal>
                  </li>
                  {showAdAfter && (
                    <li className="feed-ad-row" aria-hidden={false}>
                      <AdSlot slot="inFeed" className="ad-slot-in-feed" />
                    </li>
                  )}
                </Fragment>
              );
            }),
          )}
        </ul>
      )}

      {showViewAllLink && items.length > 0 && (
        <p className="feed-section-footer">
          <Link href="/feed">{t("viewAll")}</Link>
        </p>
      )}

      {items.length > 0 && (
        <div className="feed-section-disclosure">
          <p className="feed-disclosure-intro">{t("disclosureIntro")}</p>
          {await LegalCaveat({})}
        </div>
      )}
    </section>
  );
}
