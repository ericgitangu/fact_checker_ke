// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { TrendingItem } from "@fact-checker-ke/core";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

// Imported AFTER the mock so it exercises the real exported component.
const { TrendingSection } = await import("./trending-section");

function item(overrides: Partial<TrendingItem> = {}): TrendingItem {
  return {
    submissionId: "11111111-1111-4111-8111-111111111111",
    title: "A viral clip claiming fuel prices will halve overnight",
    platform: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=abc123",
    viralityScore: 30,
    engagement: { views: 120000, likes: 5400, comments: 320 },
    ingestSource: "fetch",
    status: "monitoring",
    checkId: null,
    observedAt: "2026-10-05T08:00:00.000Z",
    publishedAt: null,
    ...overrides,
  };
}

describe("TrendingSection", () => {
  it("renders nothing (null) when there is nothing trending", async () => {
    expect(await TrendingSection({ items: [] })).toBeNull();
  });

  it("renders the trending heading, the honest 'not a verdict' note, and one card per item", async () => {
    const jsx = await TrendingSection({
      items: [item({ submissionId: "aaaaaaaa-1111-4111-8111-111111111111", title: "first" }),
              item({ submissionId: "bbbbbbbb-2222-4222-8222-222222222222", title: "second" })],
    });
    const { getByText, container } = render(jsx!);
    getByText("Trending now — what we're tracking");
    // Honest copy: these are tracked items, not verdicts.
    getByText("Tracking status — not a fact-check verdict.");
    expect(container.querySelectorAll("article.trendingcard")).toHaveLength(2);
  });

  it("links to the source video and shows a status chip, in the item order given", async () => {
    const jsx = await TrendingSection({ items: [item({ status: "monitoring" })] });
    const { getByText, container } = render(jsx!);
    getByText("Monitoring");
    const link = container.querySelector('a[href="https://www.youtube.com/watch?v=abc123"]');
    expect(link).not.toBeNull();
    // Platform badge is shown.
    getByText("youtube");
  });

  it("for a published item, links to the check and labels it Published", async () => {
    const jsx = await TrendingSection({
      items: [
        item({
          status: "published",
          checkId: "cccccccc-3333-4333-8333-333333333333",
          publishedAt: "2026-10-05T09:00:00.000Z",
        }),
      ],
    });
    const { getByText, container } = render(jsx!);
    getByText("Published");
    const checkLink = container.querySelector('a[href="/checks/cccccccc-3333-4333-8333-333333333333"]');
    expect(checkLink).not.toBeNull();
  });

  it("for an under-review item, shows 'Under review' and NEVER a verdict/rating or a check link", async () => {
    const jsx = await TrendingSection({
      items: [item({ status: "under_review", checkId: null, title: "held for review" })],
    });
    const { getByText, queryByText, container } = render(jsx!);
    getByText("Under review");
    // No draft content leaks: no rating words, no "Read the assessment" link
    // (there's no published check to read), and no /checks/ link at all.
    expect(queryByText(/Mostly True|False|Misleading|Unproven/i)).toBeNull();
    expect(container.querySelector('a[href^="/checks/"]')).toBeNull();
  });

  it("shows a 'Not pursued' chip for a dismissed item", async () => {
    const jsx = await TrendingSection({ items: [item({ status: "dismissed" })] });
    const { getByText } = render(jsx!);
    getByText("Not pursued");
  });
});
