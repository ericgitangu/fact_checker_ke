import { describe, it, expect } from "vitest";
import {
  DemonstrationMediaSchema,
  DemonstrationSchema,
  MaandamanoResponseSchema,
  isPlatformEmbedHost,
} from "../schemas/demonstration.js";

const validDemo = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Planned march along Moi Avenue",
  area: "Nairobi Central Ward",
  county: "Nairobi",
  status: "announced" as const,
  date: "2026-10-10",
  summary: "Organisers announced a march; county has not confirmed a route.",
  sourceUrl: "https://example.com/announcement",
  updatedAt: "2026-10-03T00:00:00.000Z",
};

describe("DemonstrationSchema", () => {
  it("accepts a well-formed advisory with a ward-level area", () => {
    expect(DemonstrationSchema.safeParse(validDemo).success).toBe(true);
  });

  it("rejects an invalid status enum value", () => {
    const result = DemonstrationSchema.safeParse({ ...validDemo, status: "maybe" });
    expect(result.success).toBe(false);
  });

  // AT-0035-1: `media` is additive and defaults to [] — an existing row
  // with NO media field still validates, and the parsed value carries an
  // empty media array (the MaandamanoResponse shape is unchanged for
  // existing clients).
  it("AT-0035-1: defaults media to [] when absent, keeping existing rows valid", () => {
    const parsed = DemonstrationSchema.parse(validDemo);
    expect(parsed.media).toEqual([]);
  });

  it("AT-0035-1: a MaandamanoResponse of media-less rows still validates", () => {
    const res = MaandamanoResponseSchema.parse({ frozen: false, demonstrations: [validDemo] });
    expect(res.demonstrations[0]!.media).toEqual([]);
  });
});

describe("DemonstrationMediaSchema / host allowlist (AT-0035-2)", () => {
  const validEmbed = {
    id: "44444444-4444-4444-8444-444444444444",
    platform: "youtube" as const,
    embedUrl: "https://www.youtube.com/embed/abc123",
    caption: "A clip observed during the march",
    observedAt: "2026-10-03T00:00:00.000Z",
    misinfoStatus: "unchecked" as const,
    misinfoNote: null,
  };

  it("accepts an embed whose host is a platform embed host", () => {
    expect(DemonstrationMediaSchema.safeParse(validEmbed).success).toBe(true);
  });

  it("rejects a re-hosted/arbitrary embedUrl host (blocks re-hosting)", () => {
    const result = DemonstrationMediaSchema.safeParse({
      ...validEmbed,
      embedUrl: "https://cdn.evil.example/our-bucket/clip.mp4",
    });
    expect(result.success).toBe(false);
  });

  it("isPlatformEmbedHost accepts allowlisted hosts and rejects others", () => {
    expect(isPlatformEmbedHost("https://www.youtube.com/embed/x")).toBe(true);
    expect(isPlatformEmbedHost("https://platform.twitter.com/embed/Tweet.html")).toBe(true);
    expect(isPlatformEmbedHost("https://www.tiktok.com/embed/v2/123")).toBe(true);
    // Not a platform host, and http (not https) → rejected.
    expect(isPlatformEmbedHost("https://storage.googleapis.com/bucket/clip.mp4")).toBe(false);
    expect(isPlatformEmbedHost("http://www.youtube.com/embed/x")).toBe(false);
    expect(isPlatformEmbedHost("not a url")).toBe(false);
  });

  // A media array with no bytes field: there is no schema field that could
  // carry a re-hosted file — only a pointer (embedUrl) + metadata.
  it("AT-0035-2: the media schema has no media-bytes field", () => {
    expect(Object.keys(DemonstrationMediaSchema.shape).sort()).toEqual(
      ["caption", "embedUrl", "id", "misinfoNote", "misinfoStatus", "observedAt", "platform"].sort(),
    );
  });
});
