"use client";

import { useEffect, useId, useState } from "react";
import "./waving-flag.css";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    // Guarded for jsdom/SSR environments that don't implement
    // `matchMedia` at all (e.g. jsdom — see apps/site and this package's
    // vitest.setup.ts for the fuller rationale): without this check,
    // mounting the component anywhere matchMedia is missing throws
    // immediately. Skipping just means motion stays enabled (the default
    // `reduced` state), which is the safe fallback when the OS
    // preference genuinely can't be read.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

type WavingFlagProps = {
  className?: string;
  /** Accessible label; omit visual label since the wordmark text carries meaning. */
  title?: string;
};

/**
 * A small Kenyan flag on a pole that FLAPS in the wind — lively and
 * obvious, not a subtle shimmer — while staying smooth/premium (not
 * frantic) and readable at superscript size. Two motion layers, combined:
 *
 * 1. An SVG turbulence+displacement filter rippling the cloth's surface
 *    texture (fast-animated `feTurbulence` baseFrequency + a
 *    `feDisplacementMap`).
 * 2. A CSS transform (rotate+skewX) sway on the cloth group, anchored at
 *    the pole/hoist edge (see waving-flag.css) — this is what makes the
 *    free edge visibly flap, which is what actually reads as "flailing in
 *    the wind" rather than a gentle ripple. Transform/opacity only (GPU-
 *    friendly, no layout thrash).
 *
 * The real flag is: black / white-fimbriated red / green bands + the
 * Maasai shield over two crossed spears. Motion is gated on
 * prefers-reduced-motion — reduced renders a still, gently-furled flag
 * (both layers' animation stop) rather than a flat bar.
 */
export function WavingFlag({ className, title = "Kenya" }: WavingFlagProps): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, "");
  const wave = `wave-${uid}`;
  const sheen = `sheen-${uid}`;
  const pole = `pole-${uid}`;

  return (
    <svg
      className={className}
      viewBox="0 0 54 34"
      // The sway transform (rotate+skewX, anchored at the hoist edge) can
      // momentarily swing the free edge a couple of units past the
      // nominal viewBox at the extremes of the loop. SVG roots default to
      // `overflow: hidden`, which would clip that -- explicit
      // overflow="visible" lets the small bleed render instead (standard
      // technique for this kind of edge-anchored sway), rather than
      // clipping the flap and reading as the still/subtle version we're
      // explicitly trying to move away from.
      overflow="visible"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={pole} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a8f93" />
          <stop offset="0.5" stopColor="#d7dadc" />
          <stop offset="1" stopColor="#6c7175" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
        <filter id={wave} x="-20%" y="-30%" width="145%" height="165%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02 0.06"
            numOctaves="2"
            seed="4"
            result="noise"
          >
            {!reduced && (
              <animate
                attributeName="baseFrequency"
                dur="3s"
                values="0.02 0.06;0.034 0.09;0.016 0.045;0.02 0.06"
                repeatCount="indefinite"
              />
            )}
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="4.2"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      {/* Pole */}
      <circle cx="1.6" cy="2.4" r="1.6" fill="#c8a24a" />
      <rect x="0.8" y="2.4" width="1.6" height="31" rx="0.8" fill={`url(#${pole})`} />

      {/* Cloth: the turbulence+displacement filter ripples the surface
          texture; the fck-flag-cloth-sway class (skipped under reduced
          motion) swings the whole group from the pole/hoist edge so the
          free edge visibly flaps -- see waving-flag.css. */}
      <g
        className={`fck-flag-cloth ${reduced ? "fck-flag-cloth-still" : "fck-flag-cloth-sway"}`}
        filter={`url(#${wave})`}
      >
        {/* Bands: black / white / red / white / green (official order) */}
        <rect x="3" y="2" width="50" height="8.5" fill="#101010" />
        <rect x="3" y="10.5" width="50" height="2" fill="#f6f6f4" />
        <rect x="3" y="12.5" width="50" height="9.5" fill="#be1e2d" />
        <rect x="3" y="22" width="50" height="2" fill="#f6f6f4" />
        <rect x="3" y="24" width="50" height="8.5" fill="#046a38" />

        {/* Two crossed white spears behind the shield */}
        <g stroke="#f6f6f4" strokeWidth="1.1" strokeLinecap="round">
          <line x1="22.5" y1="8.5" x2="33.5" y2="25.5" />
          <line x1="33.5" y1="8.5" x2="22.5" y2="25.5" />
        </g>
        {/* spear tips */}
        <path d="M22.5 8.5 l1.4 0.1 -0.9 1.1 z" fill="#f6f6f4" />
        <path d="M33.5 8.5 l-1.4 0.1 0.9 1.1 z" fill="#f6f6f4" />

        {/* Maasai shield: red field, white centre stripe, black caps */}
        <ellipse cx="28" cy="17" rx="3.9" ry="8.1" fill="#be1e2d" />
        <path d="M28 8.9 a3.9 8.1 0 0 1 3.9 5.2 h-7.8 a3.9 8.1 0 0 1 3.9 -5.2 z" fill="#101010" />
        <path d="M28 25.1 a3.9 8.1 0 0 1 -3.9 -5.2 h7.8 a3.9 8.1 0 0 1 -3.9 5.2 z" fill="#101010" />
        <rect x="27.3" y="9.4" width="1.4" height="15.2" fill="#f6f6f4" />

        {/* Cloth sheen / light */}
        <rect x="3" y="2" width="50" height="30.5" fill={`url(#${sheen})`} />
      </g>
    </svg>
  );
}
