"use client";

import { useReveal } from "./use-reveal";
import "./reveal.css";

/**
 * <Reveal> / <Stagger> — the two building blocks of the house motion
 * language ("the press": content arrives as if printed onto the public
 * record, rising a few px and settling, never sliding far or bouncing).
 *
 * They are thin, presentational wrappers over `useReveal` + reveal.css:
 *  - <Reveal> reveals a single block when it scrolls into view.
 *  - <Stagger> reveals its direct children in sequence — it sets a
 *    `--fck-reveal-i` custom property per child that reveal.css turns into a
 *    transition/animation delay, so one <Stagger> orchestrates a whole
 *    row/list with no per-child wiring. This is the "one orchestrated
 *    moment per view" the brief asks for, not scattered animations.
 *
 * Both are reduced-motion-safe twice over: `useReveal` starts `revealed`
 * (so the end state shows with no animation) under prefers-reduced-motion
 * or when there's no IntersectionObserver, and reveal.css force-settles the
 * final state under the same media query regardless of JS.
 *
 * Framework-neutral (React + one plain CSS import), same contract as
 * <TwoEngineFlow> / <Wordmark>: drops into the Next.js App Router tree and
 * the Vite SPA unchanged. Both render a plain <div>; style the wrapper via
 * `className` where layout matters.
 */

type Motion = "rise" | "press" | "fade";

type RevealProps = {
  children: React.ReactNode;
  /** Which entrance. "rise" (default) lifts + fades; "press" adds the stamp overshoot; "fade" is opacity only. */
  motion?: Motion;
  /** Delay this reveal (seconds) — for hand-ordering a couple of sibling Reveals. */
  delay?: number;
  className?: string;
  threshold?: number;
};

export function Reveal({
  children,
  motion = "rise",
  delay,
  className,
  threshold,
}: RevealProps): React.JSX.Element {
  const { ref, revealed } = useReveal<HTMLDivElement>({ threshold: threshold ?? 0.2 });
  const classes = ["fck-reveal", `fck-reveal-${motion}`, revealed ? "is-revealed" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const style =
    delay != null ? ({ "--fck-reveal-delay": `${delay}s` } as React.CSSProperties) : undefined;
  return (
    <div ref={ref} className={classes} style={style}>
      {children}
    </div>
  );
}

type StaggerProps = {
  children: React.ReactNode;
  motion?: Motion;
  /** Per-child step (seconds) between each child revealing. */
  step?: number;
  /** Delay before the first child reveals (seconds). */
  delay?: number;
  className?: string;
  threshold?: number;
};

export function Stagger({
  children,
  motion = "rise",
  step = 0.08,
  delay = 0,
  className,
  threshold,
}: StaggerProps): React.JSX.Element {
  const { ref, revealed } = useReveal<HTMLDivElement>({ threshold: threshold ?? 0.2 });
  const classes = ["fck-stagger", `fck-reveal-${motion}`, revealed ? "is-revealed" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const items = Array.isArray(children) ? children : [children];
  return (
    <div ref={ref} className={classes}>
      {items.map((child, i) => (
        <div
          key={i}
          className="fck-stagger-item"
          style={
            {
              "--fck-reveal-i": i,
              "--fck-reveal-step": `${step}s`,
              "--fck-reveal-delay": `${delay}s`,
            } as React.CSSProperties
          }
        >
          {child}
        </div>
      ))}
    </div>
  );
}
