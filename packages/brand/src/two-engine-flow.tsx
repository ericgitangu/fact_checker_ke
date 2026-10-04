"use client";

import { useEffect, useRef, useState } from "react";
import {
  RadarIcon,
  PenLineIcon,
  ScissorsIcon,
  ScaleIcon,
  GaugeIcon,
  MegaphoneIcon,
  EyeIcon,
} from "./icons";
import "./two-engine-flow.css";

export type TwoEngineFlowVariant = "light" | "dark";

/** The five pipeline-step keys, in canonical sequence. */
export type FlowStepKey = "extract" | "ground" | "assess" | "publish" | "audit";

/**
 * Overridable user-facing copy for the whole diagram. Every field is
 * optional and falls back to the canonical English default below, so a host
 * that knows its locale (apps/web) can localise the flow while a host that
 * doesn't (apps/site, marketing) renders the shared English unchanged —
 * same contract as <VerdictScale>. Structure, icons, order and motion stay
 * owned by this component; only the words are overridable.
 */
export type TwoEngineFlowCopy = {
  entriesLabel?: string;
  stepsLabel?: string;
  entries?: {
    fetch?: { tag?: string; title?: string; body?: string };
    submit?: { tag?: string; title?: string; body?: string };
  };
  steps?: Partial<Record<FlowStepKey, { title?: string; body?: string }>>;
};

type TwoEngineFlowProps = {
  /** Colour variant. Default "light" (apps/web has no dark theme yet). */
  variant?: TwoEngineFlowVariant;
  /** Accessible label for the whole process region. */
  ariaLabel?: string;
  /** Localised copy; English defaults where omitted. */
  copy?: TwoEngineFlowCopy;
  className?: string;
};

type StepNode = {
  key: FlowStepKey;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

const STEPS: StepNode[] = [
  {
    key: "extract",
    icon: ScissorsIcon,
    title: "Extract",
    body: "We pull out the checkable claims and translate them, keeping the original words.",
  },
  {
    key: "ground",
    icon: ScaleIcon,
    title: "Ground",
    body: "Each claim is matched against credible sources — KNBS, Kenya Law, the Hansard, newsrooms.",
  },
  {
    key: "assess",
    icon: GaugeIcon,
    title: "Assess",
    body: "AI weighs the evidence into a confidence-weighted, claim-attributed assessment. We rate claims, not people.",
  },
  {
    key: "publish",
    icon: MegaphoneIcon,
    title: "Publish",
    body: "It goes live with its sources, a confidence weight, and the standing caveat.",
  },
  {
    key: "audit",
    icon: EyeIcon,
    title: "Audit",
    body: "A person audits a shrinking sample afterwards, and can correct it.",
  },
];

/**
 * The two-engine "how it works" flow: the single source of this diagram,
 * shared by apps/site (marketing) and apps/web (methodology) so the two
 * surfaces never drift into two different stories about how a claim gets
 * checked (see ADR-0032 / the ADR-0002 amendment — the fetch engine is
 * the PRIMARY path, not submissions).
 *
 * Structure, deliberately not a flat numbered grid:
 *  - two parallel engines (fetch = primary, submit = secondary) in a `<ul>`
 *    (they are alternatives, not a sequence)
 *  - a decorative SVG connector merging both into one spine
 *  - the shared pipeline (`extract -> ground -> assess -> publish -> audit`)
 *    in an `<ol>`, which IS a sequence, with a connecting rail drawn
 *    through the node icons
 *
 * Motion: one orchestrated reveal — the rail "grows" and each node steps
 * in with a short stagger — triggered once by IntersectionObserver on
 * first scroll into view. Fully inert under prefers-reduced-motion: the
 * component skips the observer and renders the end state immediately, and
 * the stylesheet's own reduced-motion block (belt-and-braces, same pattern
 * as waving-flag.css) forces the same end state even if JS runs late.
 *
 * Framework-neutral: only React + ./two-engine-flow.css, same contract as
 * Wordmark — drops into a Next.js Server Component tree via "use client"
 * and into the Vite SPA unchanged.
 */
/** Canonical English defaults for the two entry engines. */
const ENTRY_DEFAULTS = {
  fetch: {
    tag: "Primary engine",
    title: "We fetch",
    body:
      "We continuously surface viral, trending claims from YouTube, X, and fact-check feeds like PesaCheck and Africa Check — a pilot; TikTok is embed-only, not autonomously monitored.",
  },
  submit: {
    tag: "Secondary engine",
    title: "You submit",
    body: "Anyone can submit a link or a quote. The same pipeline checks it next.",
  },
} as const;

const ENTRIES_LABEL_DEFAULT = "How a claim enters — two engines";
const STEPS_LABEL_DEFAULT = "What happens once a claim is in";

export function TwoEngineFlow({
  variant = "light",
  ariaLabel = "How a claim gets checked",
  copy,
  className,
}: TwoEngineFlowProps): React.JSX.Element {
  const fetchCopy = { ...ENTRY_DEFAULTS.fetch, ...copy?.entries?.fetch };
  const submitCopy = { ...ENTRY_DEFAULTS.submit, ...copy?.entries?.submit };
  const entriesLabel = copy?.entriesLabel ?? ENTRIES_LABEL_DEFAULT;
  const stepsLabel = copy?.stepsLabel ?? STEPS_LABEL_DEFAULT;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      // No animation to orchestrate: show the finished state right away.
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const classes = [
    "fck-flow",
    `fck-flow-${variant}`,
    visible ? "fck-flow-visible" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} ref={rootRef} role="group" aria-label={ariaLabel}>
      <ul className="fck-flow-entries" aria-label={entriesLabel}>
        <li className="fck-flow-node fck-flow-entry fck-flow-entry-primary">
          <span className="fck-flow-icon" aria-hidden="true">
            <RadarIcon size={20} />
          </span>
          <span className="fck-flow-tag">{fetchCopy.tag}</span>
          <h3>{fetchCopy.title}</h3>
          <p>{fetchCopy.body}</p>
        </li>
        <li className="fck-flow-node fck-flow-entry fck-flow-entry-secondary">
          <span className="fck-flow-icon" aria-hidden="true">
            <PenLineIcon size={20} />
          </span>
          <span className="fck-flow-tag">{submitCopy.tag}</span>
          <h3>{submitCopy.title}</h3>
          <p>{submitCopy.body}</p>
        </li>
      </ul>

      <svg
        className="fck-flow-merge"
        viewBox="0 0 200 48"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path className="fck-flow-merge-path" d="M20 2 C20 28, 100 28, 100 46" />
        <path className="fck-flow-merge-path" d="M180 2 C180 28, 100 28, 100 46" />
      </svg>

      <ol className="fck-flow-steps" aria-label={stepsLabel}>
        {STEPS.map(({ key, icon: Icon, title, body }) => {
          const override = copy?.steps?.[key];
          return (
            <li className="fck-flow-node fck-flow-step" key={key}>
              <span className="fck-flow-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <div className="fck-flow-step-text">
                <h3>{override?.title ?? title}</h3>
                <p>{override?.body ?? body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
