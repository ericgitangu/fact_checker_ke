import { getTranslations } from "next-intl/server";
import { SubmitForm } from "./submit-form";
import { FeedSection } from "../components/feed-section";
import { getFeedPage } from "../lib/get-feed";

// A short preview (not the full paginated list — that's `/feed`), still
// live/fresh via the 30s revalidate on `getFeedPage` — this is the
// fetch engine's visible payoff on the very first thing a visitor sees,
// not buried behind a nav click.
const HOME_PREVIEW_LIMIT = 4;

export default async function Home(): Promise<React.JSX.Element> {
  const t = await getTranslations("submit");
  const feed = await getFeedPage({ limit: HOME_PREVIEW_LIMIT });

  return (
    <div className="shell flex flex-col gap-12" style={{ maxWidth: 720, marginInline: "auto" }}>
      <div className="flex flex-col gap-3">
        <h1 className="font-expanded" style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}>
          {t("heading")}
        </h1>
        <p style={{ maxWidth: "52ch", color: "var(--ink-2)" }}>{t("lede")}</p>
      </div>
      <SubmitForm />
      <FeedSection items={feed.items} isMock={feed.isMock} showViewAllLink />
    </div>
  );
}
