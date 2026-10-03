"use client";

import { useId } from "react";

/**
 * Brand mark: "FC" monogram (vertical bar + two arms for F, an open ring for
 * C) with "KE" set as a superscript, tying the wordmark to the verdict-green
 * brand colour and one complementary azure. Drawn as geometry (rects + a
 * dashed-circle ring), not <text>, so it renders identically as a favicon,
 * an OS tab icon, or an OG image overlay — contexts that don't load the
 * page's web fonts.
 *
 * `tone="gradient"` is the default brand colour (verdict-green -> azure) and
 * is reserved for the mark itself per the brief ("gradient lives in the
 * brand mark"), never as a page wash. `tone="mono"` renders in a single
 * `currentColor` for contexts that need flat ink (print, tiny favicons,
 * places already sitting on a strong background).
 */
type BrandMarkProps = {
  tone?: "gradient" | "mono";
  tile?: boolean;
  size?: number;
  className?: string;
  title?: string;
};

export function BrandMark({
  tone = "gradient",
  tile = true,
  size = 32,
  className,
  title = "fact_checker_ke",
}: BrandMarkProps): React.JSX.Element {
  // Unique per-instance gradient id — two marks on one page (nav + footer)
  // must not share an SVG <defs> id. useId() is stable across renders and
  // collision-free across instances without a module-level mutable counter.
  const gradientId = `fck-mark-grad-${useId().replace(/:/g, "")}`;
  const fill = tone === "gradient" ? `url(#${gradientId})` : "currentColor";

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
    >
      {tone === "gradient" && (
        <defs>
          <linearGradient id={gradientId} x1="2" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--brand-grad-a, #17a862)" />
            <stop offset="1" stopColor="var(--brand-grad-b, #2458d6)" />
          </linearGradient>
        </defs>
      )}
      {tile && <rect x="0" y="0" width="32" height="32" rx="8" fill="var(--mark-tile-bg, #15181b)" />}
      <rect x="6" y="7" width="4.4" height="18" rx="1.4" fill={fill} />
      <rect x="6" y="7" width="12.5" height="4.4" rx="1.4" fill={fill} />
      <rect x="6" y="14.2" width="10" height="4.2" rx="1.3" fill={fill} />
      <circle
        cx="22.2"
        cy="16"
        r="6.4"
        fill="none"
        stroke={fill}
        strokeWidth="4.3"
        strokeDasharray="30.6 9.6"
        strokeDashoffset="-9.3"
      />
      <text
        x="23.6"
        y="8"
        fontFamily="Arial, sans-serif"
        fontSize="5.1"
        fontWeight="700"
        fill={fill}
        textAnchor="middle"
        letterSpacing="0.3"
      >
        KE
      </text>
    </svg>
  );
}
