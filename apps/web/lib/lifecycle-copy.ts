import type { CheckLifecycle } from "@fact-checker-ke/core";

/**
 * ADR-0038 per-card next-step affordance copy.
 *
 * i18n NOTE / DEBT: the message catalog lives in `packages/i18n`, which is out
 * of scope for this wave (services/api + apps/web only). So this new
 * lifecycle-affordance copy is kept local and locale-aware here rather than in
 * the shared catalog. It SHOULD move into `packages/i18n`'s `feed` namespace in
 * a follow-up so a future `apps/mobile` shares it and the completeness test
 * covers it; until then en + sw are kept in parity by hand below.
 *
 * `tone` is a stable key the component maps to a CSS class (reusing existing
 * trending-status tokens — no new palette). `label` is the Wave-3 add-source
 * call-to-action text; it is rendered as a non-interactive hint today (the
 * interactive add-source UI + POST /v1/checks/:id/sources is deferred — see the
 * Wave 3 marker in lifecycle-affordance.tsx).
 */
export interface LifecycleAffordance {
  tone: "preliminary" | "awaiting" | "review" | "archived" | "dismissed";
  caption: string;
  /** Wave-3 next-step CTA label, or null when the state offers no reader action. */
  label: string | null;
  /** Whether a non-authoritative caveat ("not a verdict") must be shown. */
  caveat: boolean;
}

type Locale = "en" | "sw";

const COPY: Record<Locale, Partial<Record<CheckLifecycle, LifecycleAffordance>>> = {
  en: {
    preliminary: {
      tone: "preliminary",
      caption: "AI-grounded preliminary — not a verdict, not yet verified.",
      label: "Help verify",
      caveat: true,
    },
    awaiting_sources: {
      tone: "awaiting",
      caption: "No sources yet.",
      label: "Submit the truth",
      caveat: true,
    },
    editor_review: {
      tone: "review",
      caption: "Under editorial review.",
      label: null,
      caveat: false,
    },
    archived_expired: {
      tone: "archived",
      caption: "Archived — unverified.",
      label: "Reopen with a source",
      caveat: false,
    },
    dismissed: {
      tone: "dismissed",
      caption: "Not pursued.",
      label: null,
      caveat: false,
    },
  },
  sw: {
    preliminary: {
      tone: "preliminary",
      caption: "Tathmini ya awali ya AI — si uamuzi, bado haijathibitishwa.",
      label: "Saidia kuthibitisha",
      caveat: true,
    },
    awaiting_sources: {
      tone: "awaiting",
      caption: "Bado hakuna vyanzo.",
      label: "Wasilisha ukweli",
      caveat: true,
    },
    editor_review: {
      tone: "review",
      caption: "Inakaguliwa na mhariri.",
      label: null,
      caveat: false,
    },
    archived_expired: {
      tone: "archived",
      caption: "Imehifadhiwa — haijathibitishwa.",
      label: "Fungua upya kwa chanzo",
      caveat: false,
    },
    dismissed: {
      tone: "dismissed",
      caption: "Haikufuatiliwa.",
      label: null,
      caveat: false,
    },
  },
};

/**
 * The next-step affordance for a lifecycle state, or null when the card should
 * render its ordinary verdict instead (`published`, `verifying`, or an
 * unknown/null state). `published` deliberately returns null — a published card
 * shows the verdict + rating, which is its own affordance.
 */
export function lifecycleAffordanceFor(
  lifecycleState: CheckLifecycle | null | undefined,
  locale: string,
): LifecycleAffordance | null {
  if (!lifecycleState) return null;
  const table = COPY[locale === "sw" ? "sw" : "en"];
  return table[lifecycleState] ?? null;
}
