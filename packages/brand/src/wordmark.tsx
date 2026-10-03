"use client";

import { BrandMark } from "./brand-mark";
import { WavingFlag } from "./waving-flag";
import "./wordmark.css";

export type WordmarkSize = "sm" | "md" | "lg";
export type WordmarkVariant = "light" | "dark" | "mono";

const MARK_PX: Record<WordmarkSize, number> = { sm: 22, md: 32, lg: 44 };

type WordmarkProps = {
  /** Type scale + mark size. Default "md" (matches the original nav mark). */
  size?: WordmarkSize;
  /** Text colour and tricolour treatment. Default "light". */
  variant?: WordmarkVariant;
  /** Renders the "fact_checker_ke" text node alongside the mark. Default true. */
  showText?: boolean;
  /**
   * When `showText` is false AND the brand name is already conveyed by
   * surrounding content (e.g. a footer's own sentence), set this so the
   * icon-only mark doesn't need its own accessible name. Leave it false
   * when the mark stands alone (e.g. inside a link with its own
   * aria-label).
   */
  decorative?: boolean;
  className?: string;
};

/**
 * The fact_checker_ke brand lockup: the FC·KE mark, the wordmark text, and
 * a superscript waving Kenyan flag tucked at the tip of "...ke" — a
 * considered national cue, not the flag used as a page wash, in keeping
 * with the product's non-partisan "independent fact-checker" positioning.
 *
 * This is the SINGLE SOURCE of the fact_checker_ke identity (ADR: brand/nav
 * unification) — both apps/site (Vite SPA) and apps/web (Next.js App
 * Router) import this component directly rather than keeping local copies,
 * so the mark, wordmark, flag and typography never drift between them
 * again. Framework-neutral by design: only React + ./wordmark.css (plus
 * ./brand-mark and ./waving-flag, which have their own CSS-variable
 * fallbacks) — no app-specific token system import — and `"use client"` so
 * it drops straight into a Next.js Server Component tree.
 *
 * Keeps a real "fact_checker_ke" text node in the DOM whenever `showText`
 * is true (apps/site's App.test.tsx depends on there being exactly one
 * such node across the page — see apps/site's App.tsx for how that's kept
 * singular between the nav and footer usages).
 */
export function Wordmark({
  size = "md",
  variant = "light",
  showText = true,
  decorative = false,
  className,
}: WordmarkProps): React.JSX.Element {
  const classes = ["fck-wordmark", `fck-wordmark-${size}`, `fck-wordmark-${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...(decorative && !showText ? { "aria-hidden": "true" } : {})}>
      <BrandMark
        size={MARK_PX[size]}
        tone={variant === "mono" ? "mono" : "gradient"}
        className="fck-wordmark-mark"
      />
      {showText && (
        <span className="fck-wordmark-nametag">
          <span className="fck-wordmark-text">fact_checker_ke</span>
          {variant !== "mono" && <WavingFlag className="fck-wordmark-flag" />}
        </span>
      )}
    </span>
  );
}
