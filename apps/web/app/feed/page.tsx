import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FeedSection } from "../../components/feed-section";
import { getFeedPage } from "../../lib/get-feed";

export const metadata: Metadata = {
  title: "What we're checking now — fact_checker_ke",
  description:
    "A live stream of recently published, confidence-weighted fact-check assessments — claims we caught trending and claims readers submitted, sources cited.",
};

const FEED_PAGE_LIMIT = 20;

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
  const feed = await getFeedPage({ limit: FEED_PAGE_LIMIT, cursor: cursor ?? null });

  return (
    <div className="shell-narrow flex flex-col gap-6">
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
