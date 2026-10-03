/**
 * Client-side, no-network heuristic that powers the "smart input" on the
 * submit screen: as the user pastes a URL or types free text, this tells
 * the UI whether to show a source-preview card, a video moment-marker, or
 * neither — all synchronously, with no new backend call (the brief is
 * explicit: "basic detection" only, no live platform API lookups here).
 *
 * This is pattern-matching on the pasted string, not a guarantee — a
 * misdetected platform just means the UI shows a plainer preview, never a
 * submission failure (the BFF route re-validates the actual payload shape
 * with SubmissionInputSchema regardless of what this guessed).
 */

export type Platform = "youtube" | "tiktok" | "x" | "threads" | "news" | "unknown";

export interface UrlDetection {
  kind: "url";
  url: string;
  platform: Platform;
  /** Only set for platform "youtube" — the only one we can embed without an SDK. */
  youtubeVideoId: string | null;
  /** True for platforms where "mark the moment + the claim" applies (ADR-0002). */
  isVideoPlatform: boolean;
}

export interface TextDetection {
  kind: "text";
  text: string;
}

export interface EmptyDetection {
  kind: "empty";
}

export type Detection = UrlDetection | TextDetection | EmptyDetection;

const YOUTUBE_WATCH_RE = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,})/i;
const YOUTUBE_SHORT_RE = /^https?:\/\/youtu\.be\/([\w-]{6,})/i;
const YOUTUBE_SHORTS_RE = /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([\w-]{6,})/i;

function extractYoutubeId(url: string): string | null {
  for (const re of [YOUTUBE_WATCH_RE, YOUTUBE_SHORT_RE, YOUTUBE_SHORTS_RE]) {
    const match = re.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

function detectPlatform(url: URL): { platform: Platform; youtubeVideoId: string | null } {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const href = url.toString();

  if (host === "youtube.com" || host === "youtu.be") {
    return { platform: "youtube", youtubeVideoId: extractYoutubeId(href) };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return { platform: "tiktok", youtubeVideoId: null };
  }
  if (host === "x.com" || host === "twitter.com") {
    return { platform: "x", youtubeVideoId: null };
  }
  if (host === "threads.net" || host === "threads.com") {
    return { platform: "threads", youtubeVideoId: null };
  }
  return { platform: "news", youtubeVideoId: null };
}

const VIDEO_PLATFORMS: ReadonlySet<Platform> = new Set(["youtube", "tiktok", "x", "threads"]);

/** Tries to parse `raw` as an absolute URL; returns null (not a throw) if it isn't one. */
function tryParseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function detectSource(raw: string): Detection {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "empty" };

  // Only treat it as a URL if the ENTIRE trimmed input parses as one — a
  // sentence that happens to contain a URL substring stays "text" (the
  // user is quoting a claim, not submitting a link).
  const url = tryParseUrl(trimmed);
  if (url) {
    const { platform, youtubeVideoId } = detectPlatform(url);
    return {
      kind: "url",
      url: trimmed,
      platform,
      youtubeVideoId,
      isVideoPlatform: VIDEO_PLATFORMS.has(platform),
    };
  }

  return { kind: "text", text: trimmed };
}

export function formatMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(clamped / 60);
  const ss = clamped % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
