// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { FeedItem } from "@fact-checker-ke/core";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

// Imported AFTER the mock so it exercises the real exported component.
const { ViralSection } = await import("./viral-section");

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: crypto.randomUUID(),
    claim: "a viral claim",
    rating: "MostlyTrue",
    calibratedConfidence: 0.9,
    ingestSource: "fetch",
    riskTier: "A",
    whatWouldChangeThis: "New facts.",
    context: "The claim overstates a real trend.",
    viralityScore: 10,
    publishedAt: "2026-09-29T07:12:00.000Z",
    sources: [],
    ...overrides,
  };
}

describe("ViralSection (feed virality)", () => {
  it("renders the 'most viral' heading and one card per item, in the order given", async () => {
    const items = [item({ claim: "first", viralityScore: 30 }), item({ claim: "second", viralityScore: 20 })];
    const jsx = await ViralSection({ items });
    const { getByText, container } = render(jsx!);

    getByText("Most viral right now");
    const cards = container.querySelectorAll("article.feedcard");
    expect(cards).toHaveLength(2);
    // DOM order IS the ranking (brief: top-3 by virality, already sorted by caller).
    const claims = [...container.querySelectorAll("article.feedcard")].map((c) => c.getAttribute("aria-label"));
    expect(claims).toEqual(["first", "second"]);
  });

  it("degrades gracefully with fewer than 3 items (renders the 1 it has)", async () => {
    const jsx = await ViralSection({ items: [item({ claim: "only one" })] });
    const { container } = render(jsx!);
    expect(container.querySelectorAll("article.feedcard")).toHaveLength(1);
  });

  it("renders nothing (null) when there is nothing viral — the descending feed owns emptiness", async () => {
    const jsx = await ViralSection({ items: [] });
    expect(jsx).toBeNull();
  });
});
