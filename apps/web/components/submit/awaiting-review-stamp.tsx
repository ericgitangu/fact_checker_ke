"use client";

import { useTranslations } from "next-intl";

/**
 * This screen has no verdict yet — deliberately NOT styled with any of
 * the verdict colours (--true/--false/etc.) or even the amber
 * .ai-assisted-note tint, so it never hints at an eventual rating.
 * Restrained ink/paper only, same visual family as the real
 * .verdict-stamp (rotation, weight) so it reads as "a stamp will go
 * here", not a different component language.
 */
export function AwaitingReviewStamp(): React.JSX.Element {
  const t = useTranslations("submit");
  return <span className="awaiting-review-stamp">{t("awaitingReview")}</span>;
}
