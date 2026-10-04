"use client";

import { useReveal } from "./use-reveal";
import "./confidence-gauge.css";

/**
 * <ConfidenceGauge> — the bespoke replacement for a bare "88%" wherever a
 * published assessment shows its calibrated confidence weight (ADR-0031).
 * A confidence weight is NOT a verdict, so this never borrows the verdict
 * colour system: the arc is drawn in the brand mark's own green→azure
 * accent (the same hue reserved for the typing caret and focus glow), so a
 * reader never mistakes "how sure the evidence makes us" for the rating
 * itself.
 *
 * It renders a semicircular dial that sweeps up to the value once it
 * scrolls into view — one orchestrated motion, keyed off the shared
 * `useReveal`. The arc length is driven by `stroke-dashoffset`, transitioned
 * in CSS; the needle tick rides the same reveal. Reduced-motion-safe twice
 * over: `useReveal` starts revealed (final arc shown, no sweep) under
 * prefers-reduced-motion or without IntersectionObserver, and
 * confidence-gauge.css force-settles the arc under the same media query.
 *
 * Accessibility: the whole figure is a `role="meter"` with
 * aria-valuemin/now/max and a text label, so assistive tech reads out the
 * real number; the SVG is decorative (aria-hidden) and the printed digits
 * are a redundant visual readout, never the only source of the value.
 */

export type ConfidenceGaugeVariant = "light" | "dark";
export type ConfidenceGaugeSize = "sm" | "md";

type ConfidenceGaugeProps = {
  /** Calibrated confidence, 0–1. Clamped defensively. */
  value: number;
  /** Visible + accessible label, e.g. "Confidence weight". */
  label: string;
  variant?: ConfidenceGaugeVariant;
  size?: ConfidenceGaugeSize;
  className?: string;
};

// Semicircle arc geometry: r=40 in a 100x58 box, drawn left→right over the
// top. Arc length = π·r, the dash runway the value fill rides along.
const R = 40;
const ARC_LENGTH = Math.PI * R; // ≈ 125.66
const CX = 50;
const CY = 50;

function polarPoint(fraction: number): { x: number; y: number } {
  // fraction 0 → left end (180°), 1 → right end (0°)
  const angle = Math.PI * (1 - fraction);
  return { x: CX + R * Math.cos(angle), y: CY - R * Math.sin(angle) };
}

export function ConfidenceGauge({
  value,
  label,
  variant = "light",
  size = "md",
  className,
}: ConfidenceGaugeProps): React.JSX.Element {
  const { ref, revealed } = useReveal<HTMLDivElement>({ threshold: 0.4 });
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const pct = Math.round(clamped * 100);
  const offset = ARC_LENGTH * (1 - clamped);
  const tick = polarPoint(clamped);

  const classes = [
    "fck-gauge",
    `fck-gauge-${variant}`,
    `fck-gauge-${size}`,
    revealed ? "is-revealed" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={classes}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${label}: ${pct}%`}
    >
      <svg className="fck-gauge-svg" viewBox="0 0 100 58" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`fck-gauge-grad-${variant}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--fck-gauge-grad-a)" />
            <stop offset="100%" stopColor="var(--fck-gauge-grad-b)" />
          </linearGradient>
        </defs>
        <path className="fck-gauge-track" d={`M10 ${CY} A${R} ${R} 0 0 1 90 ${CY}`} />
        <path
          className="fck-gauge-fill"
          d={`M10 ${CY} A${R} ${R} 0 0 1 90 ${CY}`}
          stroke={`url(#fck-gauge-grad-${variant})`}
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={revealed ? offset : ARC_LENGTH}
        />
        <circle
          className="fck-gauge-tick"
          cx={revealed ? tick.x : 10}
          cy={revealed ? tick.y : CY}
          r={3.2}
        />
      </svg>
      <div className="fck-gauge-readout">
        <span className="fck-gauge-value">{pct}</span>
        <span className="fck-gauge-unit">%</span>
      </div>
      <span className="fck-gauge-label">{label}</span>
    </div>
  );
}
