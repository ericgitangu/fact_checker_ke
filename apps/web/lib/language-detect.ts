/**
 * STUB — a deliberately simple word-list heuristic, not a real language
 * classifier. Good enough to show "here's roughly what we detected" chips
 * while composing a submission; NOT used for anything that affects the
 * actual pipeline (the real claim-extraction/translation step is
 * services/pipeline's job, out of this agent's ownership). Flagged
 * honestly rather than presented as production NLP.
 */

export type DetectedLanguage = "en" | "sw" | "sheng";

const SWAHILI_MARKERS = [
  "ni", "na", "wa", "ya", "kwa", "hii", "hiyo", "watu", "serikali", "nchi",
  "habari", "asante", "karibu", "rafiki", "sasa", "leo", "kesho", "bei",
  "pesa", "kila", "sana", "sio", "haina", "wanasema",
];

const SHENG_MARKERS = [
  "msee", "noma", "fiti", "mbogi", "manze", "buda", "doh", "ndai", "mathree",
  "ukora", "poa", "sasa", "bro", "waah", "deng", "chapaa",
];

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z']+/i)
      .filter((w) => w.length > 0),
  );
}

/**
 * Returns the detected languages as a small ranked set (chips render in
 * this order). Always includes at least one entry — falls back to `en`
 * when no markers match, since the catalog/UI default is English.
 */
export function detectLanguages(text: string): DetectedLanguage[] {
  const words = wordSet(text);
  if (words.size === 0) return ["en"];

  let shengHits = 0;
  let swHits = 0;
  for (const w of words) {
    if (SHENG_MARKERS.includes(w)) shengHits += 1;
    if (SWAHILI_MARKERS.includes(w)) swHits += 1;
  }

  const detected: DetectedLanguage[] = [];
  // English is near-universal in Latin-script text (shared alphabet with
  // SW/Sheng), so we only suppress the "en" chip when Swahili/Sheng
  // markers dominate the sample heavily enough to suggest it's not
  // primarily English.
  const total = words.size;
  const nonEnglishRatio = (shengHits + swHits) / total;

  if (shengHits > 0) detected.push("sheng");
  if (swHits > 0) detected.push("sw");
  if (detected.length === 0 || nonEnglishRatio < 0.5) detected.push("en");

  return detected;
}
