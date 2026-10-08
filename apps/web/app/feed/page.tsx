import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FeedSection } from "../../components/feed-section";
import { ViralSection } from "../../components/viral-section";
import { TrendingSection } from "../../components/trending-section";
import { getFeedPage } from "../../lib/get-feed";
import { getTrending } from "../../lib/get-trending";

export const metadata: Metadata = {
  title: "What we're checking now — fact_checker_ke",
  description:
    "A live stream of recently published, confidence-weighted fact-check assessments — claims we caught trending and claims readers submitted, sources cited.",
};

const FEED_PAGE_LIMIT = 20;
const TRENDING_LIMIT = 8;

/**
 * ADR-0032's visible payoff, as its own route: the full "what we're
 * checking now" feed, not just the home-page preview. Server-rendered
 * (no client JS needed for the basic list — the brief explicitly says
 * keep the "live" touch simple rather than faking real-time), with a
 * plain server-rendered "load older" link driving keyset pagination via
 * `?cursor=` rather than client-side state.
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<React.JSX.Element> {
  const { cursor } = await searchParams;
  const t = await getTranslations("feed");
  // The trending stream is only shown on the first page (like the viral
  // section) — a reader paging "load older" has already seen it. Fetched in
  // parallel with the feed; a trending failure degrades to an empty,
  // self-hiding section without affecting the feed.
  const isFirstPage = !cursor;
  const [feed, trending] = await Promise.all([
    getFeedPage({ limit: FEED_PAGE_LIMIT, cursor: cursor ?? null }),
    isFirstPage ? getTrending({ limit: TRENDING_LIMIT }) : Promise.resolve([]),
  ]);

  return (
    <div className="shell-narrow flex flex-col gap-6">
      {/* "Trending / under review" leads the page: the fetch engine's
          DISCOVERIES (viral items we're tracking), surfaced regardless of
          publish status — self-hiding when there's nothing trending. */}
      <TrendingSection items={trending} />

      {/* "Most viral right now" (top-3 PUBLISHED by reach) sits below it —
          additive, and self-hiding (renders null) when nothing qualifies, so
          an all-submission feed is unaffected. */}
      {/* ADR-0038 Wave 3: a second "Most followed" rail (new claim_follows counter) attaches here alongside Most-viral — deferred until the follows counter exists. */}
      <ViralSection items={feed.topViral} />

      <FeedSection
        items={feed.items}
        isMock={feed.isMock}
        emptyAction={!feed.isMock ? { href: "/submit", label: t("empty.cta") } : undefined}
      />

      {!feed.isMock && feed.nextCursor && (
        <p>
          <Link href={`/feed?cursor=${encodeURIComponent(feed.nextCursor)}`}>{t("loadOlder")}</Link>
        </p>
      )}

      {/* The empty state above already carries its own "submit a claim"
          action — a second bare "Back home" link under it would be the
          same tacky duplicate link the owner originally flagged. Keep it
          only once the feed actually has rows to come back from. */}
      {feed.items.length > 0 && (
        <p>
          <Link href="/">{t("backHome")}</Link>
        </p>
      )}
    </div>
  );
}
