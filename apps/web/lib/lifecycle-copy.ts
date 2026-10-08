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

/**
 * ADR-0038 Wave 2: copy for the interactive add-source form (the `AddSourceForm`
 * client island the affordance CTA opens). Kept local + locale-aware here for
 * the SAME i18n-scope reason as the affordance copy above (packages/i18n is out
 * of this wave's scope); en + sw are kept in parity by hand and SHOULD move to
 * the shared `feed` catalog in a follow-up.
 */
export interface AddSourceFormCopy {
  urlLabel: string;
  urlPlaceholder: string;
  noteLabel: string;
  notePlaceholder: string;
  submit: string;
  submitting: string;
  cancel: string;
  /**
   * Ack when the source was ACCEPTED (tier1_primary/tier2_established_media)
   * AND it crossed the re-verify threshold — `reVerifyQueued: true` on the
   * submit response. A re-check is genuinely enqueued now.
   */
  ackQueued: string;
  /**
   * Ack when the source was ACCEPTED but did NOT cross the threshold —
   * `reVerifyQueued: false`. Recorded, but no re-check fires yet; must not
   * promise one is imminent.
   */
  ackAcceptedPending: string;
  /**
   * Ack when the source was REJECTED (non-credible domain/tier). It will not
   * move the verdict; invite a stronger source instead of implying a re-check.
   */
  ackRejected: string;
  /** Ack for a duplicate (already submitted for this check). */
  ackDuplicate: string;
  /** Generic failure. */
  error: string;
}

const FORM_COPY: Record<Locale, AddSourceFormCopy> = {
  en: {
    urlLabel: "Source link",
    urlPlaceholder: "https://…",
    noteLabel: "Note (optional)",
    notePlaceholder: "What does this source show?",
    submit: "Submit source",
    submitting: "Submitting…",
    cancel: "Cancel",
    ackQueued: "Thanks — that's enough credible sources; we're re-checking now.",
    ackAcceptedPending:
      "Source recorded from a credible publisher. We re-check once enough credible sources are gathered.",
    ackRejected:
      "That link isn't from a publisher we recognise as credible, so it won't move the verdict on its own. A source from a recognised outlet or primary record would help.",
    ackDuplicate: "Already submitted — thanks.",
    error: "Couldn't submit that source. Please try again.",
  },
  sw: {
    urlLabel: "Kiungo cha chanzo",
    urlPlaceholder: "https://…",
    noteLabel: "Dokezo (hiari)",
    notePlaceholder: "Chanzo hiki kinaonyesha nini?",
    submit: "Wasilisha chanzo",
    submitting: "Inawasilisha…",
    cancel: "Ghairi",
    ackQueued: "Asante — hivyo ni vyanzo vya kutosha vinavyoaminika; tunakagua tena sasa.",
    ackAcceptedPending:
      "Chanzo kimerekodiwa kutoka chapisho linaloaminika. Tunakagua tena baada ya kukusanya vyanzo vya kutosha vinavyoaminika.",
    ackRejected:
      "Kiungo hicho si cha chapisho tunalolitambua kuwa linaloaminika, kwa hivyo hakitabadilisha uamuzi peke yake. Chanzo kutoka chombo kinachotambulika au kumbukumbu asili kingesaidia.",
    ackDuplicate: "Tayari kimewasilishwa — asante.",
    error: "Imeshindikana kuwasilisha chanzo. Tafadhali jaribu tena.",
  },
};

export function addSourceFormCopyFor(locale: string): AddSourceFormCopy {
  return FORM_COPY[locale === "sw" ? "sw" : "en"];
}

/**
 * ADR-0038 Wave 3: the prefix for a non-named preliminary's AI DRAFT STANCE,
 * composed with the rating label (from the shared `check.rating.*` catalog) as
 * "AI-grounded: <stance>". Kept local + locale-aware for the SAME i18n-scope
 * reason as the affordance copy above (packages/i18n is out of this wave's
 * scope); en + sw are kept in parity by hand and SHOULD move to the shared
 * `feed` catalog in a follow-up. This label is deliberately NOT the saturated
 * verdict chip — it reads as a caveated stance, never the authoritative verdict.
 */
export function aiGroundedStancePrefixFor(locale: string): string {
  return locale === "sw" ? "Mwelekeo wa AI: " : "AI-grounded: ";
}

/**
 * ADR-0038 Wave 3 "Most followed" rail copy. The rail is FALLING BACK to
 * "Most recent" ordering until a `claim_follows` counter exists (packages/db is
 * fenced this wave — see the follows-upgrade marker in `most-recent-section.tsx`
 * and the repo's `listHomeRailRecent`). Kept local + locale-aware for the same
 * i18n-scope reason as the affordance copy above; SHOULD move to the shared
 * `feed` catalog alongside a "Most followed" heading when follows ship.
 */
export interface HomeRailCopy {
  heading: string;
  intro: string;
}

export function homeRailRecentCopyFor(locale: string): HomeRailCopy {
  return locale === "sw"
    ? { heading: "Za hivi karibuni", intro: "Madai mapya zaidi tunayofanyia kazi — yaliyochapishwa na nyuzi zilizo wazi." }
    : {
        heading: "Most recent",
        intro: "The freshest claims we're working on — published verdicts and open threads alike.",
      };
}
