import { describe, it, expect } from "vitest";
import { detectSource, formatMmSs, isShortenerUrl } from "./claim-source-detection";

describe("detectSource", () => {
  it("returns empty for blank input", () => {
    expect(detectSource("   ")).toEqual({ kind: "empty" });
  });

  it("detects a YouTube watch URL and extracts the video id", () => {
    const d = detectSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s");
    expect(d).toMatchObject({ kind: "url", platform: "youtube", youtubeVideoId: "dQw4w9WgXcQ", isVideoPlatform: true });
  });

  it("detects a youtu.be short URL", () => {
    const d = detectSource("https://youtu.be/dQw4w9WgXcQ");
    expect(d).toMatchObject({ kind: "url", platform: "youtube", youtubeVideoId: "dQw4w9WgXcQ" });
  });

  it("detects TikTok as a video platform without a video id", () => {
    const d = detectSource("https://www.tiktok.com/@user/video/123456");
    expect(d).toMatchObject({ kind: "url", platform: "tiktok", youtubeVideoId: null, isVideoPlatform: true });
  });

  it("detects X/Twitter (both x.com and twitter.com)", () => {
    expect(detectSource("https://x.com/user/status/1")).toMatchObject({ platform: "x" });
    expect(detectSource("https://twitter.com/user/status/1")).toMatchObject({ platform: "x" });
  });

  it("detects Threads", () => {
    const d = detectSource("https://www.threads.net/@user/post/abc");
    expect(d).toMatchObject({ platform: "threads", isVideoPlatform: true });
  });

  it("falls back to 'news' (not a video platform) for an arbitrary article URL", () => {
    const d = detectSource("https://www.nation.africa/kenya/news/some-article-12345");
    expect(d).toMatchObject({ kind: "url", platform: "news", isVideoPlatform: false });
  });

  it("treats a sentence containing a URL-looking substring as text, not a URL", () => {
    const d = detectSource("They said https://example.com proves it, which is false");
    expect(d.kind).toBe("text");
  });

  it("treats free text as text", () => {
    expect(detectSource("Unemployment fell to 2% last year")).toEqual({
      kind: "text",
      text: "Unemployment fell to 2% last year",
    });
  });
});

describe("formatMmSs", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatMmSs(0)).toBe("0:00");
    expect(formatMmSs(5)).toBe("0:05");
    expect(formatMmSs(65)).toBe("1:05");
    expect(formatMmSs(3600)).toBe("60:00");
  });

  it("clamps negative values to 0:00", () => {
    expect(formatMmSs(-10)).toBe("0:00");
  });
});

describe("isShortenerUrl", () => {
  it("recognises known shorteners (with or without www.)", () => {
    expect(isShortenerUrl("https://share.google/NHHtEozjG6LQwKgmp")).toBe(true);
    expect(isShortenerUrl("https://bit.ly/abc")).toBe(true);
    expect(isShortenerUrl("http://www.tinyurl.com/x")).toBe(true);
    expect(isShortenerUrl("  https://t.co/abc  ")).toBe(true);
  });

  it("does not treat real platforms (incl. youtu.be), articles, text or lookalikes as shorteners", () => {
    expect(isShortenerUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(false);
    expect(isShortenerUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isShortenerUrl("https://example.com/bit.ly")).toBe(false);
    expect(isShortenerUrl("https://bit.ly.evil.com/x")).toBe(false);
    expect(isShortenerUrl("not a url")).toBe(false);
    expect(isShortenerUrl("ftp://bit.ly/x")).toBe(false);
  });
});
