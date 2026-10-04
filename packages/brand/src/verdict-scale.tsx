"use client";

import { useReveal } from "./use-reveal";
import {
  VerdictTrueIcon,
  VerdictMostlyTrueIcon,
  VerdictMisleadingIcon,
  VerdictFalseIcon,
  VerdictUnprovenIcon,
  VerdictNotCheckableIcon,
} from "./icons";
import "./verdict-scale.css";

/**
 * <VerdictScale> — the signature set piece, and the single source of the
 * six-verdict scale for BOTH apps. It replaces the old flat coloured-dot
 * rows (apps/site's `.scale-list`, apps/web methodology's bordered `<dl>`)
 * the owner flagged as the #1 eye-sore.
 *
 * The idea: a fact-checker's verdicts are stamps pressed onto the public
 * record, so each verdict is a crafted SEAL — a bespoke glyph in a
 * double-ruled ink tile (the inset second ring + dot-grain texture echo the
 * full-size verdict stamp on a check page), carrying its earned colour. The
 * six seals "stamp in" in sequence as the scale scrolls into view (the house
 * "press" motion), and press again on hover/focus. This is the one
 * orchestrated moment of its view.
 *
 * The icon set is deliberate, not six lucide defaults (see icons.tsx): the
 * four graded evidentiary verdicts share a ring family; Misleading (a
 * refracted line) and Not checkable (a speech mark) break the ring because
 * they sit off the true↔false axis.
 *
 * Copy is canonical brand English, carried in the component — same contract
 * as <TwoEngineFlow>, so the two apps can never drift into two different
 * descriptions of the same scale. (Localisation of this editorial copy is a
 * known, shared gap with TwoEngineFlow, tracked separately — not this
 * component's drift.)
 *
 * Reduced-motion-safe twice over: `useReveal` starts revealed (final state,
 * no stamp) under prefers-reduced-motion or without IntersectionObserver,
 * and verdict-scale.css force-settles under the same media query.
 */

export type VerdictScaleVariant = "light" | "dark";

type VerdictScaleProps = {
  variant?: VerdictScaleVariant;
  /** Accessible label for the list. */
  ariaLabel?: string;
  className?: string;
};

type VerdictDef = {
  key: string;
  name: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

/** Declaration order IS display order: supported → not, then the two off-axis. */
const VERDICTS: VerdictDef[] = [
  {
    key: "true",
    name: "True",
    description: "Backed by credible evidence, with no material caveat.",
    Icon: VerdictTrueIcon,
  },
  {
    key: "mostly",
    name: "Mostly true",
    description: "Accurate in the main — but missing context shifts the picture.",
    Icon: VerdictMostlyTrueIcon,
  },
  {
    key: "misleading",
    name: "Misleading",
    description: "Sourced, yet framed to imply what the evidence doesn't.",
    Icon: VerdictMisleadingIcon,
  },
  {
    key: "false",
    name: "False",
    description: "Contradicted by the credible evidence we can find.",
    Icon: VerdictFalseIcon,
  },
  {
    key: "unproven",
    name: "Unproven",
    description: "No reliable evidence either way — not yet.",
    Icon: VerdictUnprovenIcon,
  },
  {
    key: "notcheckable",
    name: "Not checkable",
    description: "An opinion, a prediction, or a matter of belief — not a fact.",
    Icon: VerdictNotCheckableIcon,
  },
];

export function VerdictScale({
  variant = "light",
  ariaLabel = "The six-verdict rating scale",
  className,
}: VerdictScaleProps): React.JSX.Element {
  const { ref, revealed } = useReveal<HTMLUListElement>({ threshold: 0.15 });

  const classes = [
    "fck-scale",
    `fck-scale-${variant}`,
    revealed ? "is-revealed" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ul className={classes} aria-label={ariaLabel} ref={ref}>
      {VERDICTS.map(({ key, name, description, Icon }, i) => (
        <li
          key={key}
          className={`fck-scale-item fck-scale-${key}`}
          style={{ "--fck-scale-i": i } as React.CSSProperties}
        >
          <span className="fck-scale-seal" aria-hidden="true">
            <Icon size={24} className="fck-scale-glyph" />
          </span>
          <span className="fck-scale-body">
            <span className="fck-scale-name">{name}</span>
            <span className="fck-scale-desc">{description}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
