"use client";

/**
 * UI icon hints, in the lucide/shadcn visual language (24x24, round-cap
 * strokes, `currentColor`). Path data is lucide-static's own (ISC licensed)
 * for sun/moon/external-link/shield-check, inlined as local components
 * rather than adding the `lucide-react` package dependency to this shared
 * package. Same icon set, zero extra lockfile dependency.
 */
type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false" };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SunIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function MoonIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 14, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function ShieldCheckIcon({ size = 16, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/*
 * Two-engine flow icons (see two-engine-flow.tsx): one per pipeline node.
 * Same inlining rationale as above — lucide-static path data, no
 * `lucide-react` dependency added to the shared package.
 */

export function RadarIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  );
}

export function PenLineIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M13 21h8" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  );
}

export function ScissorsIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  );
}

export function ScaleIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M12 3v18" />
      <path d="m19 8 3 8a5 5 0 0 1-6 0zV7" />
      <path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" />
      <path d="m5 8 3 8a5 5 0 0 1-6 0zV7" />
      <path d="M7 21h10" />
    </svg>
  );
}

export function GaugeIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

export function MegaphoneIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
      <path d="M8 6v8" />
    </svg>
  );
}

export function EyeIcon({ size = 18, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/*
 * ---- Verdict glyphs (see verdict-scale.tsx) -------------------------------
 *
 * A DELIBERATE icon system, not six interchangeable lucide defaults. The
 * four graded evidentiary verdicts (True / Mostly true / False / Unproven)
 * share a ring family — they all sit on the same "what does the evidence
 * support?" axis, so they read as one scale. The two off-axis verdicts
 * break the ring on purpose: Misleading is a *refracted line* (the facts
 * are real, the framing bends them), and Not checkable is a *speech mark*
 * (it's an opinion or prediction — not on the true↔false axis at all).
 * Authored here in the same 24x24 round-cap stroke language as the set
 * above, geometry hand-tuned rather than copied, so the scale is ours.
 *
 * Each takes a stroke-drawing `drawn` escape hatch: the path lengths are
 * fixed via CSS (verdict-scale.css) so the mark can "ink in" on reveal;
 * the component only toggles a class, the icons stay presentational.
 */

/** True — sealed ring + confident check. The full, closed ring = the top of the scale. */
export function VerdictTrueIcon({ size = 22, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="m7.75 12.5 2.75 2.75L16.5 9" />
    </svg>
  );
}

/** Mostly true — same check, but the ring is left open at the top: affirmed, with a gap. */
export function VerdictMostlyTrueIcon({ size = 22, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M14.5 3.5a9 9 0 1 1-5 0" />
      <path d="m7.75 12.5 2.75 2.75L16.5 9" />
    </svg>
  );
}

/** Misleading — a straight ray that kinks at a boundary: real facts, bent framing. */
export function VerdictMisleadingIcon({ size = 22, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M3 7h18" strokeDasharray="2.5 3" />
      <path d="M5 4.5 11 11l-2 7.5" />
      <path d="m9 18.5 5-3.25" />
    </svg>
  );
}

/** False — ring + decisive cross. */
export function VerdictFalseIcon({ size = 22, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </svg>
  );
}

/** Unproven — ring + question: the evidence isn't in yet. */
export function VerdictUnprovenIcon({ size = 22, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.4a2.6 2.6 0 0 1 4.7 1.5c0 1.7-2.5 2.2-2.5 3.6" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

/** Not checkable — a speech mark, off the true↔false axis: opinion, prediction, belief. */
export function VerdictNotCheckableIcon({ size = 22, className, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true" {...rest}>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
      <path d="M8.5 10.5h.01" />
      <path d="M12 10.5h.01" />
      <path d="M15.5 10.5h.01" />
    </svg>
  );
}
