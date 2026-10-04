import type { DemonstrationStatus } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import {
  ActivityIcon,
  BanIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  FlagIcon,
  MegaphoneIcon,
} from "@fact-checker-ke/brand";

/**
 * Maandamano advisory status — deliberately NOT the verdict colour scale
 * (see globals.css `--status-*` tokens). A protest status is not a
 * fact-check rating; reusing --true/--false here would visually imply a
 * verdict was passed on whether the protest itself is "true".
 *
 * Each status also carries an apt glyph (lucide-family, same stroke
 * language as the verdict/flow icons) so the chip reads at a glance — the
 * iconed-chip treatment consistent with the verdict chip, without
 * borrowing the verdict colours or glyphs.
 */
const STATUS_CLASS: Record<DemonstrationStatus, string> = {
  rumoured: "s-rumoured",
  announced: "s-announced",
  confirmed: "s-confirmed",
  ongoing: "s-ongoing",
  ended: "s-ended",
  cancelled: "s-cancelled",
};

const STATUS_ICON: Record<
  DemonstrationStatus,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  rumoured: CircleHelpIcon,
  announced: MegaphoneIcon,
  confirmed: CircleCheckIcon,
  ongoing: ActivityIcon,
  ended: FlagIcon,
  cancelled: BanIcon,
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
  const Icon = STATUS_ICON[status];
  return (
    <span className={`status-chip ${STATUS_CLASS[status]}`}>
      <Icon size={14} className="status-chip-icon" />
      {t(STATUS_KEY[status])}
    </span>
  );
}
