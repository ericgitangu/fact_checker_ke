import { describe, it, expect } from "vitest";
import { cleanTrendingTitle } from "../lib/trending-title.js";

describe("cleanTrendingTitle", () => {
  it("drops an advertisement block and the hashtag wall, keeping the lead claim", () => {
    // Captured from the live trending feed (fact-checker-ke-web/feed), 2026-10-06.
    const raw =
      "Opposition have given President William Ruto 14 days to reveal details of the Dangote refinery dea " +
      "Welcome to Newsline Media & Training Agency! We offer professional media attachment opportunities to " +
      "college students, helping them gain practical skills and industry experience. Location: Zuhura Place, " +
      "4th Floor, Opposite Quickmart Supermarket, Thika Town. Call Us: 0712 275 450 Email: " +
      "Newslinedigitaltv@gmail.com #FINANCE BILL #MORNING RUSH Find Us On Social Media: Facebook: Newsline " +
      "Media and Training Agency YouTube: Newsline TV Instagram: Newsline.tv #rutolivetoday #gachaguatoday " +
      "#fuelcrisis #statehousedramafestival #trending #Kenya #ThikaTown #subscribe";
    const out = cleanTrendingTitle(raw);
    expect(out).toBe(
      "Opposition have given President William Ruto 14 days to reveal details of the Dangote refinery dea",
    );
    // Ad + hashtags are gone.
    expect(out).not.toMatch(/#/);
    expect(out.toLowerCase()).not.toContain("welcome to");
    expect(out).not.toContain("0712");
    expect(out.toLowerCase()).not.toContain("gmail.com");
    expect(out.toLowerCase()).not.toContain("youtube:");
  });

  it("collapses a title that is repeated verbatim in the description, then strips the hashtag wall", () => {
    const title = "GACHAGUA NI PROPHET!! SHA IMEKUFIA ZIMBABWE!! FEARLESS MAN DESTROY RUTO RUTHLESSLY";
    const raw =
      `${title} ${title} #gachagua #kenyakwanza #government #matiangi #matiangiforpresident #edwinsifuna ` +
      "#matiangi2027 #politicalnews #viralvideo #railaodinga #ruto #trendingnews #topstories #safaricomforyou #2024";
    const out = cleanTrendingTitle(raw);
    expect(out).toBe(title);
    expect(out).not.toMatch(/#/);
  });

  it("keeps a clean claim untouched", () => {
    const raw = "Court suspends the new fuel levy pending a hearing next week.";
    expect(cleanTrendingTitle(raw)).toBe(raw);
  });

  it("caps very long text on a word boundary with an ellipsis", () => {
    const raw = "word ".repeat(100).trim();
    const out = cleanTrendingTitle(raw);
    expect(out.length).toBeLessThanOrEqual(241); // 240 + ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\bwor$/); // no mid-word cut
  });

  it("falls back for empty / all-noise input", () => {
    expect(cleanTrendingTitle("")).toBe("Untitled trending clip");
    expect(cleanTrendingTitle(null)).toBe("Untitled trending clip");
    expect(cleanTrendingTitle("#trending #viral #foryou")).toBe("Untitled trending clip");
  });
});
