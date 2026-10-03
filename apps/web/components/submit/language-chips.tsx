"use client";

import type { DetectedLanguage } from "../../lib/language-detect";

const LABELS: Record<DetectedLanguage, string> = {
  en: "English",
  sw: "Swahili",
  sheng: "Sheng",
};

/** Heuristic, client-side only — see lib/language-detect.ts's own disclaimer. */
export function LanguageChips({ languages }: { languages: DetectedLanguage[] }): React.JSX.Element {
  return (
    <div className="language-chips">
      {languages.map((lang) => (
        <span key={lang} className="lang-chip">
          {LABELS[lang]}
        </span>
      ))}
    </div>
  );
}
