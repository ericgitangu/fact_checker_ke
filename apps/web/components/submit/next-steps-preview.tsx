"use client";

import { useTranslations } from "next-intl";

const STEPS = ["received", "analyzing", "verifying", "ready"] as const;

/**
 * Illustrative only — NOT the live tracker (components/status-tracker.tsx
 * is that, post-submission). Every step renders "pending" except the
 * first gets a subtle "active" emphasis, so it reads as "here's what
 * will happen", not a live status a user might mistake for progress
 * already made.
 */
export function NextStepsPreview(): React.JSX.Element {
  const t = useTranslations("submit");
  return (
    <div className="next-steps-preview">
      <h3>{t("nextSteps.heading")}</h3>
      <ol className="pipeline-track">
        {STEPS.map((step, i) => (
          <li key={step} data-state={i === 0 ? "active" : "pending"}>
            <p>{t(`nextSteps.${step}`)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
