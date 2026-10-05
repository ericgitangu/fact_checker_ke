// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { cleanup, render } from "@testing-library/react";
import type { TrendingItem } from "@fact-checker-ke/core";
import { componentAxeOptions, expectNoAxeViolations } from "../test/axe-config";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

const { TrendingSection } = await import("./trending-section");

const items: TrendingItem[] = [
  {
    submissionId: "11111111-1111-4111-8111-111111111111",
    title: "A viral clip claiming fuel prices will halve overnight",
    platform: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=abc123",
    viralityScore: 42.1,
    engagement: { views: 1_200_000, likes: 54000, comments: 3200 },
    ingestSource: "fetch",
    status: "under_review",
    checkId: null,
    observedAt: "2026-10-05T08:00:00.000Z",
    publishedAt: null,
  },
  {
    submissionId: "22222222-2222-4222-8222-222222222222",
    title: "A clip we published an assessment for",
    platform: "tiktok",
    sourceUrl: "https://www.tiktok.com/@x/video/222",
    viralityScore: 30.5,
    engagement: { views: 90000, likes: 4000, comments: 220 },
    ingestSource: "fetch",
    status: "published",
    checkId: "33333333-3333-4333-8333-333333333333",
    observedAt: "2026-10-04T08:00:00.000Z",
    publishedAt: "2026-10-04T18:00:00.000Z",
  },
];

describe("TrendingSection a11y", () => {
  it("a populated trending stream has zero serious/critical axe violations", async () => {
    const jsx = await TrendingSection({ items });
    const { container } = render(jsx!);
    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });
});
