import { ActivityIcon, BanIcon, ScaleIcon } from "@fact-checker-ke/brand";
import type { AddSourceFormCopy, LifecycleAffordance } from "../lib/lifecycle-copy";
import { AddSourceForm } from "./add-source-form";

/**
 * ADR-0038 per-card next-step affordance. Presentational + synchronous: the
 * caller resolves the copy with `lifecycleAffordanceFor(lifecycleState, locale)`
 * and passes the result, so the locale is read once per card (not here).
 *
 * Reuses the EXISTING trending-status chip tokens (`ts-*`) — no new palette,
 * per "reuse the design system; do not restyle".
 *
 * ADR-0038 Wave 2: when the caller can supply a `checkId` AND copy (i.e. there
 * is a real, non-leaked check to target), the `label` CTA becomes the
 * interactive `AddSourceForm` island (opens URL+note → POST
 * `/v1/checks/:id/sources`). When no `checkId` is available — notably a
 * fetch-DISCOVERED trending item still under review, whose draft check id is
 * deliberately NOT exposed to the client (TrendingItem.checkId is null unless
 * published) — it falls back to the original NON-interactive hint rather than
 * leak a draft id.
 *
 * A preliminary / awaiting_sources card NEVER renders a rating — the card
 * swaps the verdict for this affordance precisely so a non-authoritative,
 * not-yet-verified item (incl. named-person) can't show a verdict chip.
 */
const TONE_CLASS: Record<LifecycleAffordance["tone"], string> = {
  preliminary: "ts-monitoring",
  awaiting: "ts-monitoring",
  review: "ts-under-review",
  archived: "ts-dismissed",
  dismissed: "ts-dismissed",
};

const TONE_ICON: Record<LifecycleAffordance["tone"], React.ComponentType<{ size?: number; className?: string }>> = {
  preliminary: ActivityIcon,
  awaiting: ActivityIcon,
  review: ScaleIcon,
  archived: BanIcon,
  dismissed: BanIcon,
};

export function LifecycleAffordance({
  affordance,
  checkId,
  formCopy,
}: {
  affordance: LifecycleAffordance;
  /** The check id to attach a source to. Omitted when none is safely available
   * (e.g. a trending draft, whose id is not exposed) → non-interactive hint. */
  checkId?: string | null;
  /** Locale-resolved add-source form copy (resolved server-side by the card). */
  formCopy?: AddSourceFormCopy;
}): React.JSX.Element {
  const Icon = TONE_ICON[affordance.tone];
  const interactive = Boolean(affordance.label && checkId && formCopy);
  return (
    <div className="lifecycle-affordance">
      <span className={`status-chip ${TONE_CLASS[affordance.tone]}`}>
        <Icon size={14} className="status-chip-icon" />
        {affordance.caption}
      </span>
      {interactive ? (
        <AddSourceForm checkId={checkId!} triggerLabel={affordance.label!} copy={formCopy!} />
      ) : (
        affordance.label && (
          // No safe check id to target (e.g. a trending item still under review,
          // whose draft id is never exposed) — fall back to the non-interactive
          // next-step hint rather than leak a draft id.
          <span className="feedcard-caveat-note lifecycle-affordance-cta" aria-disabled="true">
            {affordance.label} →
          </span>
        )
      )}
    </div>
  );
}
