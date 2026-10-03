import type { DemonstrationStatus } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";

/**
 * Maandamano advisory status — deliberately NOT the verdict colour scale
 * (see globals.css `--status-*` tokens). A protest status is not a
 * fact-check rating; reusing --true/--false here would visually imply a
 * verdict was passed on whether the protest itself is "true".
 */
const STATUS_CLASS: Record<DemonstrationStatus, string> = {
  rumoured: "s-rumoured",
  announced: "s-announced",
  confirmed: "s-confirmed",
  ongoing: "s-ongoing",
  ended: "s-ended",
  cancelled: "s-cancelled",
};

const STATUS_KEY: Record<DemonstrationStatus, string> = {
  rumoured: "status.rumoured",
  announced: "status.announced",
  confirmed: "status.confirmed",
  ongoing: "status.ongoing",
  ended: "status.ended",
  cancelled: "status.cancelled",
};

export async function DemonstrationStatusChip({
  status,
}: {
  status: DemonstrationStatus;
}): Promise<React.JSX.Element> {
  const t = await getTranslations("tracker");
  return <span className={`status-chip ${STATUS_CLASS[status]}`}>{t(STATUS_KEY[status])}</span>;
}
