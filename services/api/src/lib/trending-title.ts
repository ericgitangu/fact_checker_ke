/**
 * Clean a fetch-discovered viral item's raw text for DISPLAY in the trending
 * stream.
 *
 * A fetch submission's `text` is the YouTube "title\ndescription"
 * (youtube_fetch_source.py). In the wild that carries three kinds of noise
 * after the actual claim/headline: (a) a channel self-promo / advertisement
 * block (contact details, "Welcome to <agency>", social handles), (b) a
 * trailing hashtag WALL (dozens of #tags), and (c) the title repeated verbatim
 * at the start of the description. This keeps the lead claim and drops the rest.
 *
 * DISPLAY-ONLY: callers pass `submissions.text`; the stored raw text is left
 * untouched so the pipeline's claim detection and the audit trail still see the
 * full original. Pure + deterministic (unit-tested against real captured feeds).
 */

// The ad/self-promo block follows the claim; cut at the EARLIEST of these.
// Each marks the start of promotional boilerplate, never the lead headline.
const PROMO_MARKERS: readonly RegExp[] = [
  /https?:\/\//i, // any URL
  /\bwww\.\S/i,
  /[\w.+-]+@[\w-]+\.[\w.-]{2,}/, // email address
  /(?:\+?254|\b0)\d[\d\s)(-]{7,}\d/, // Kenyan phone number
  /\bcall us\b/i,
  /\bwhats\s?app\b/i,
  /\bemail\s*:/i,
  /\blocation\s*:/i,
  /\bwelcome to\b/i,
  /\bfind us on\b/i,
  /\bfollow us\b/i,
  /\bsubscribe\b/i,
  /\b(?:facebook|instagram|youtube|tiktok|twitter|telegram)\s*:/i,
  // Channel self-promo outros (captured from live feeds: "<Channel> is your
  // trusted source for breaking news... We deliver timely...").
  /\bis your (?:trusted|number one|no\.? ?1|go-to|most reliable)\b/i,
  /\bwe deliver\b/i,
  /\bthanks for watching\b/i,
  /\bdon'?t forget to\b/i,
  /\blike\s*,?\s*(?:comment\s*,?\s*)?(?:and\s*)?subscribe\b/i,
  /\bhit the bell\b/i,
];

const MAX_LEN = 240;
const FALLBACK = "Untitled trending clip";

function stripHashtags(s: string): string {
  // Unicode-aware: a '#' followed by letters/digits/underscore.
  return s.replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function cleanTrendingTitle(raw: string | null | undefined): string {
  const original = (raw ?? "").replace(/[\r\n]+/g, " ");
  if (!original.trim()) return FALLBACK;

  // 1) Cut at the earliest promotional/contact marker.
  let cut = original.length;
  for (const m of PROMO_MARKERS) {
    const idx = original.search(m);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  let s = original.slice(0, cut);

  // 2) Drop hashtag walls (they appear anywhere) + collapse whitespace.
  s = stripHashtags(s);

  // 3) Collapse an immediately-repeated lead phrase (title echoed in the desc,
  //    e.g. "TITLE TITLE extra" -> "TITLE extra"). Lazy, so the shortest
  //    repeating prefix wins; anchored so it only touches a leading echo.
  s = s.replace(/^(.{15,}?)\s+\1(?=\s|$)/u, "$1").trim();

  // 4) Strip trailing connective debris left by the cut.
  s = s.replace(/[\s|•·\-–—,;:]+$/u, "").trim();

  // 5) Fallback: the whole lead was promo/hashtags — salvage the raw, de-walled.
  if (!s) s = stripHashtags(original);
  if (!s) return FALLBACK;

  // 6) Cap length on a word boundary.
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN).replace(/\s+\S*$/u, "").trim() + "…";
  }
  return s;
}
