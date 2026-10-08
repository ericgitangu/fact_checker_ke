// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { FeedItemView } from "../lib/lifecycle-read-model";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

// Imported AFTER the mock so it exercises the real exported component.
const { FeedItemCard } = await import("./feed-item-card");

function openThread(overrides: Partial<FeedItemView> = {}): FeedItemView {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    claim: "A claim still being worked on.",
    rating: null,
    calibratedConfidence: null,
    ingestSource: "submission",
    riskTier: "A",
    whatWouldChangeThis: null,
    context: "What the claim asserts and how it might mislead.",
    viralityScore: null,
    publishedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    sources: [],
    lifecycleState: "preliminary",
    authoritative: false,
    ...overrides,
  };
}

describe("FeedItemCard — ADR-0038 Wave 3 open threads", () => {
  it("a NON-named preliminary with a rating shows the AI-grounded stance, not the authoritative verdict chip", async () => {
    const jsx = await FeedItemCard({ item: openThread({ rating: "False", riskTier: "A" }) });
    const { container, getByText } = render(jsx);

    // Stance rendered behind the AI-caveat affordance...
    getByText(/AI-grounded:/);
    getByText(/AI-grounded: False/);
    // ...as a caveat chip, NOT the saturated verdict stamp.
    expect(container.querySelector(".feedcard-ai-stance")).toBeTruthy();
    expect(container.querySelector(".verdict-chip")).toBeNull();
    // The next-step affordance (status chip) is present.
    expect(container.querySelector(".lifecycle-affordance .status-chip")).toBeTruthy();
  });

  it("a named-person (riskTier C) preliminary with no exposed rating shows the affordance only — never a rating or stance", async () => {
    // The read model withholds the rating for a 'C' item, so the view carries null.
    const jsx = await FeedItemCard({ item: openThread({ rating: null, riskTier: "C" }) });
    const { container, queryByText } = render(jsx);

    expect(queryByText(/AI-grounded:/)).toBeNull();
    expect(container.querySelector(".feedcard-ai-stance")).toBeNull();
    expect(container.querySelector(".verdict-chip")).toBeNull();
    expect(container.querySelector(".lifecycle-affordance .status-chip")).toBeTruthy();
  });

  it("an awaiting_sources thread shows the add-source affordance, no rating", async () => {
    const jsx = await FeedItemCard({ item: openThread({ lifecycleState: "awaiting_sources", rating: null }) });
    const { container, queryByText } = render(jsx);

    expect(queryByText(/AI-grounded:/)).toBeNull();
    expect(container.querySelector(".verdict-chip")).toBeNull();
    expect(container.querySelector(".lifecycle-affordance .status-chip")).toBeTruthy();
  });

  it("a published verdict still renders the authoritative verdict chip (no affordance regression)", async () => {
    const jsx = await FeedItemCard({
      item: openThread({
        lifecycleState: "published",
        authoritative: true,
        rating: "MostlyTrue",
        publishedAt: "2026-09-21T00:00:00.000Z",
        calibratedConfidence: 0.8,
      }),
    });
    const { container, queryByText } = render(jsx);

    expect(container.querySelector(".verdict-chip")).toBeTruthy();
    expect(queryByText(/AI-grounded:/)).toBeNull();
    expect(container.querySelector(".lifecycle-affordance")).toBeNull();
  });
});
