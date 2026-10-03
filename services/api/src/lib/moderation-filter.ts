import type { ObjectionableContentScorer } from "@fact-checker-ke/core";

/**
 * ADR-0024 §2: "A lightweight classifier... screens for slurs, doxxing
 * patterns (phone numbers, national ID formats, addresses), and spam
 * links." This is the FAKE, no-billable-call implementation the task's
 * hard rule requires — a keyword/regex scorer, not a call to any
 * external moderation API or LLM. It implements
 * `ObjectionableContentScorer` so a real ML scorer can be swapped in
 * later without touching `services/api/src/lib/moderation.ts`'s caller.
 */
const KENYAN_PHONE_PATTERN = /(?:\+254|0)7\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/;
const NATIONAL_ID_PATTERN = /\b\d{8}\b/;
const SPAM_LINK_PATTERN = /https?:\/\/[^\s]+\.(?:xyz|top|click|loan|win)\b/i;

// A deliberately small, non-exhaustive illustrative slur list — a real
// deployment would source this from a maintained, Kenyan-context-aware
// list, not hardcode one here (tracked as tech debt below).
const SLUR_KEYWORDS = ["slur-placeholder-one", "slur-placeholder-two"];

export class FakeObjectionableContentScorer implements ObjectionableContentScorer {
  async score(text: string): Promise<{ flagged: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    if (KENYAN_PHONE_PATTERN.test(text)) reasons.push("phone_number_pattern");
    if (NATIONAL_ID_PATTERN.test(text)) reasons.push("national_id_pattern");
    if (SPAM_LINK_PATTERN.test(text)) reasons.push("spam_link_pattern");
    const lower = text.toLowerCase();
    if (SLUR_KEYWORDS.some((word) => lower.includes(word))) reasons.push("slur_keyword");
    // No network/model call -- synchronous checks wrapped in a resolved
    // promise only to satisfy the pluggable-scorer interface's async shape.
    return Promise.resolve({ flagged: reasons.length > 0, reasons });
  }
}
