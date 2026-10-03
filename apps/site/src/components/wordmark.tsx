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
   * surrounding content (e.g. the footer's own sentence), set this so the
   * icon-only mark doesn't need its own accessible name. Leave it false
   * when the mark stands alone (e.g. inside a link with its own
   * aria-label) — see nav usage in App.tsx.
   */
  decorative?: boolean;
  className?: string;
};

/**
 * The fact_checker_ke brand lockup: the FC·KE mark, the wordmark text, and
 * a restrained Kenyan-tricolour accent rule underneath it — a considered
 * national cue, not the flag itself, in keeping with the product's
 * non-partisan "independent fact-checker" positioning.
 *
 * Self-contained by design: only React and ./wordmark.css (plus
 * ./brand-mark, which has its own CSS-variable fallbacks) — no import from
 * apps/site's token system — so this component can be lifted as-is into a
 * shared package for apps/web to reuse without modification.
 *
 * Keeps a real "fact_checker_ke" text node in the DOM whenever `showText`
 * is true (App.test.tsx's `getByText("fact_checker_ke")` depends on there
 * being exactly one such node across the page — see the nav vs. footer
 * usage in App.tsx for how that's kept singular).
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
      {showText && <span className="fck-wordmark-text">fact_checker_ke</span>}
      {showText && variant !== "mono" && <WavingFlag className="fck-wordmark-flag" />}
    </span>
  );
}
