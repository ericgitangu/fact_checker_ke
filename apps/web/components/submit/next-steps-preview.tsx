"use client";

import { useTranslations } from "next-intl";
import { Stagger, PenLineIcon, ScissorsIcon, GaugeIcon, MegaphoneIcon } from "@fact-checker-ke/brand";

/**
 * Illustrative only — NOT the live tracker (components/status-tracker.tsx
 * is that, post-submission). It reads as "here's what will happen", not a
 * live status a user might mistake for progress already made: every step
 * renders "pending" except the first, which gets a subtle "active"
 * emphasis.
 *
 * Elevated into an iconed mini-stepper (design pass 2026-10-04): the four
 * steps sit on a connecting rail with the same lucide-family glyphs the
 * shared <TwoEngineFlow> pipeline uses (extract/assess/publish), so the
 * submit screen's "what happens next" speaks the identical visual language
 * as the methodology flow. One orchestrated reveal via <Stagger> (the house
 * press motion), reduced-motion-safe at the useReveal source + reveal.css +
 * the globals.css belt-and-braces block. Honest copy is unchanged — AI
 * assesses, confidence-weighted publish, people audit afterward.
 */
const STEPS = [
  { key: "received", Icon: PenLineIcon },
  { key: "analyzing", Icon: ScissorsIcon },
  { key: "verifying", Icon: GaugeIcon },
  { key: "ready", Icon: MegaphoneIcon },
] as const;

export function NextStepsPreview(): React.JSX.Element {
  const t = useTranslations("submit");
  return (
    <div className="next-steps-preview">
      <h3>{t("nextSteps.heading")}</h3>
      <Stagger className="pipeline-steps" motion="rise" step={0.08} threshold={0.15}>
        {STEPS.map(({ key, Icon }, i) => (
          <div key={key} className="pipeline-step" data-state={i === 0 ? "active" : "pending"}>
            <span className="pipeline-step-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <p className="pipeline-step-text">{t(`nextSteps.${key}`)}</p>
          </div>
        ))}
      </Stagger>
    </div>
  );
}
