import { ActivityIcon, BanIcon, ScaleIcon } from "@fact-checker-ke/brand";
import type { LifecycleAffordance } from "../lib/lifecycle-copy";

/**
 * ADR-0038 per-card next-step affordance. Presentational + synchronous: the
 * caller resolves the copy with `lifecycleAffordanceFor(lifecycleState, locale)`
 * and passes the result, so the locale is read once per card (not here).
 *
 * Reuses the EXISTING trending-status chip tokens (`ts-*`) — no new palette,
 * per "reuse the design system; do not restyle". The `label` is the Wave-3
 * add-source call-to-action; it renders today as a NON-interactive hint (the
 * interactive add-source UI + `POST /v1/checks/:id/sources` are deferred).
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

export function LifecycleAffordance({ affordance }: { affordance: LifecycleAffordance }): React.JSX.Element {
  const Icon = TONE_ICON[affordance.tone];
  return (
    <div className="lifecycle-affordance">
      <span className={`status-chip ${TONE_CLASS[affordance.tone]}`}>
        <Icon size={14} className="status-chip-icon" />
        {affordance.caption}
      </span>
      {affordance.label && (
        // ADR-0038 Wave 3: this becomes the interactive add-source control
        // (opens the add-source form → POST /v1/checks/:id/sources) once the
        // crowdsource endpoint + claim_source_submissions table land. Until
        // then it is a non-interactive next-step hint.
        <span className="feedcard-caveat-note lifecycle-affordance-cta" aria-disabled="true">
          {affordance.label} →
        </span>
      )}
    </div>
  );
}
