import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FeedSection } from "../../components/feed-section";
import { ViralSection } from "../../components/viral-section";
import { MostRecentSection } from "../../components/most-recent-section";
import { TrendingSection } from "../../components/trending-section";
import { getHomeFeedPage } from "../../lib/get-feed";
import { getTrending } from "../../lib/get-trending";

export const metadata: Metadata = {
  title: "What we're checking now — fact_checker_ke",
  description:
    "A live stream of recently published, confidence-weighted fact-check assessments — claims we caught trending and claims readers submitted, sources cited.",
};

const FEED_PAGE_LIMIT = 20;
const TRENDING_LIMIT = 8;

/**
 * ADR-0032's visible payoff, as its own route, EXTENDED by ADR-0038 Wave 3:
 * the full "what we're checking now" feed — now the UNIFIED home feed that
 * INTERLEAVES published verdicts with OPEN THREADS (preliminary /
 * awaiting_sources), so the AI-grounded preliminaries are finally public. Two
 * highlight rails lead the page (Most viral + Most recent), the mixed feed
 * renders below them. Server-rendered, with a plain "load more" link driving
 * KEYSET pagination via the opaque `?cursor=` the API returns (no client state).
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<React.JSX.Element> {
  const { cursor } = await searchParams;
  const t = await getTranslations("feed");
  // The rails + trending stream are only shown on the first page — a reader
  // paging "load more" has already seen them (the API omits the rails on a
  // cursor request). Fetched in parallel; a trending failure degrades to an
  // empty, self-hiding section without affecting the feed.
  const isFirstPage = !cursor;
  const [feed, trending] = await Promise.all([
    getHomeFeedPage({ limit: FEED_PAGE_LIMIT, cursor: cursor ?? null }),
    isFirstPage ? getTrending({ limit: TRENDING_LIMIT }) : Promise.resolve([]),
  ]);

  return (
    <div className="shell-narrow flex flex-col gap-6">
      {/* ADR-0038 Wave 3: two highlight rails lead the page. "Most viral"
          (top by reach) and "Most recent" (the second rail — a Most-followed
          FALLBACK until a claim_follows counter exists; see MostRecentSection).
          Both self-hide (render null) when empty, so an empty/early feed is
          unaffected. Each spans published verdicts AND open threads. */}
      <ViralSection items={feed.mostViral} />
      <MostRecentSection items={feed.mostRecent} />

      {/* "Trending / under review": the fetch engine's DISCOVERIES (viral items
          we're tracking), surfaced regardless of publish status — self-hiding
          when there's nothing trending. */}
      <TrendingSection items={trending} />

      {/* The main MIXED feed (published + open threads), keyset-paginated. */}
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
