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
