import type { TrendingStatus } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import { ActivityIcon, BanIcon, CircleCheckIcon, ScaleIcon } from "@fact-checker-ke/brand";

/**
 * The tracking-status chip for the "Trending / under review" stream.
 * Deliberately NOT the verdict colour scale (globals.css `--status-*` tokens,
 * same rule as `DemonstrationStatusChip`): a trending item's status is where
 * it is in OUR pipeline, never a fact-check rating. "Under review" in
 * particular must read as "a human is still assessing this", not as a verdict —
 * reusing --true/--false here would wrongly imply one was passed.
 */
const STATUS_CLASS: Record<TrendingStatus, string> = {
  monitoring: "ts-monitoring",
  under_review: "ts-under-review",
  published: "ts-published",
  dismissed: "ts-dismissed",
};

const STATUS_ICON: Record<TrendingStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  monitoring: ActivityIcon,
  under_review: ScaleIcon,
  published: CircleCheckIcon,
  dismissed: BanIcon,
};

export async function TrendingStatusChip({ status }: { status: TrendingStatus }): Promise<React.JSX.Element> {
  const t = await getTranslations("feed");
  const Icon = STATUS_ICON[status];
  return (
    <span className={`status-chip trending-status-chip ${STATUS_CLASS[status]}`}>
      <Icon size={14} className="status-chip-icon" />
      {t(`trending.status.${status}`)}
    </span>
  );
}
