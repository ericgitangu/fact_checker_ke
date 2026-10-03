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
