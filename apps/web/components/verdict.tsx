import type { Rating } from "@fact-checker-ke/core";
import { getTranslations } from "next-intl/server";
import {
  VerdictTrueIcon,
  VerdictMostlyTrueIcon,
  VerdictMisleadingIcon,
  VerdictFalseIcon,
  VerdictUnprovenIcon,
  VerdictNotCheckableIcon,
} from "@fact-checker-ke/brand";

/**
 * The bespoke verdict glyphs (packages/brand), one per rating — the same
 * icon system as the <VerdictScale> set piece, so a feed-row chip and the
 * scale on the methodology page speak the identical visual language.
 */
const RATING_ICON: Record<Rating, React.ComponentType<{ size?: number; className?: string }>> = {
  True: VerdictTrueIcon,
  MostlyTrue: VerdictMostlyTrueIcon,
  Misleading: VerdictMisleadingIcon,
  False: VerdictFalseIcon,
  Unproven: VerdictUnprovenIcon,
  NotCheckable: VerdictNotCheckableIcon,
};

/**
 * The verdict stamp is the ONE saturated-colour object on any page (see
 * apps/web/app/globals.css header comment, and apps/site/src/index.css for
 * the original design rationale) — every other UI element stays ink-on-
 * paper. Never reused for anything that isn't a published fact-check
 * rating (the Maandamano status chips use a deliberately separate
 * neutral/amber/grey scale — see components/status-chip.tsx).
 *
 * These are server components (no "use client") that pull copy from the
 * `check` i18n namespace via `next-intl/server`'s `getTranslations` — they
 * are rendered from server components (checks/[id]/page.tsx) so this needs
 * no client-side provider. The submission-status tracker (a client
 * component, for the live SSE view) uses the `useTranslations` hook
 * instead — see components/status-tracker.tsx.
 */

const RATING_KEYS: Record<Rating, string> = {
  True: "rating.True",
  MostlyTrue: "rating.MostlyTrue",
  Misleading: "rating.Misleading",
  False: "rating.False",
  Unproven: "rating.Unproven",
  NotCheckable: "rating.NotCheckable",
};

export async function VerdictStamp({ rating }: { rating: Rating }): Promise<React.JSX.Element> {
  const t = await getTranslations("check");
  return (
    <div className={`verdict v-${rating}`}>
      <span className="verdict-stamp">{t(RATING_KEYS[rating])}</span>
    </div>
  );
}

/** Compact variant for list views (e.g. the feed, a future checks index). */
export async function VerdictChip({ rating }: { rating: Rating }): Promise<React.JSX.Element> {
  const t = await getTranslations("check");
  const Icon = RATING_ICON[rating];
  return (
    <span className={`verdict-chip v-${rating}`}>
      <Icon size={15} className="verdict-chip-icon" />
      {t(RATING_KEYS[rating])}
    </span>
  );
}

/**
 * AT-0004-B: a draft check shown to its own submitter carries
 * `rating: null` and must NOT render a verdict stamp at all — not a
 * greyed-out placeholder, not "Pending". This is that explicit
 * replacement state.
 */
export async function AwaitingEditorNotice(): Promise<React.JSX.Element> {
  const t = await getTranslations("check");
  return (
    <p className="awaiting-editor" role="status">
      <span aria-hidden="true">●</span>
      {t("draft.awaitingEditor")}
    </p>
  );
}

export async function AiAssistedNote(): Promise<React.JSX.Element> {
  const t = await getTranslations("check");
  return <span className="ai-assisted-note">{t("aiAssisted")}</span>;
}
