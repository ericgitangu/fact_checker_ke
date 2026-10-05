// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { cleanup, render } from "@testing-library/react";
import type { FeedItem } from "@fact-checker-ke/core";
import { componentAxeOptions, expectNoAxeViolations } from "../test/axe-config";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

// Imported AFTER the mock, same convention as check-card.a11y.test.tsx --
// this exercises the real exported FeedSection, not a re-implementation.
const { FeedSection } = await import("./feed-section");

const fetchItem: FeedItem = {
  id: "11111111-1111-4111-8111-111111111111",
  claim: '"Fuel prices will drop by at least 10% this month."',
  rating: "MostlyTrue",
  calibratedConfidence: 0.88,
  ingestSource: "fetch",
  riskTier: "A",
  whatWouldChangeThis: "A revised EPRA pricing circular.",
  context: "The claim predicts a 10% fuel-price drop; the EPRA formula caps prices rather than guaranteeing a cut, so the figure overstates it.",
  publishedAt: "2026-09-29T07:12:00.000Z",
  sources: [
    {
      sourceId: "22222222-2222-4222-8222-222222222222",
      quote: "The maximum retail price decreases by Ksh 8.20 per litre.",
      url: "https://example.com/epra-pricing-sept-2026",
      title: "EPRA monthly pump price guidance, Sept 2026",
      publisher: "Energy and Petroleum Regulatory Authority",
      credibilityTier: "tier1_primary",
    },
  ],
};

const submissionItem: FeedItem = {
  ...fetchItem,
  id: "33333333-3333-4333-8333-333333333333",
  ingestSource: "submission",
  rating: "False",
};

describe("FeedSection a11y (ADR-0032 payoff)", () => {
  it("a populated feed has zero serious/critical axe violations", async () => {
    const jsx = await FeedSection({ items: [fetchItem, submissionItem], isMock: false, showViewAllLink: true });
    const { container } = render(jsx);
    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });

  it("the honest empty state has zero serious/critical axe violations", async () => {
    const jsx = await FeedSection({ items: [], isMock: false });
    const { container } = render(jsx);
    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });
});

describe("FeedSection ingest-source badge + empty state (ADR-0032 AT-0032-6 payoff)", () => {
  it("distinguishes a fetch-sourced item (Auto-surfaced) from a submission-sourced one (Submitted)", async () => {
    const jsx = await FeedSection({ items: [fetchItem, submissionItem], isMock: false });
    const { getByText } = render(jsx);
    expect(getByText("Auto-surfaced")).toBeTruthy();
    expect(getByText("Submitted")).toBeTruthy();
  });

  it("renders the honest empty state, never fake rows, when there is nothing published", async () => {
    const jsx = await FeedSection({ items: [], isMock: false });
    const { getByText, queryByText } = render(jsx);
    expect(getByText("The feed fills as we publish — nothing yet")).toBeTruthy();
    expect(queryByText("Auto-surfaced")).toBeNull();
  });

  it("renders a visible demo-data notice when falling back to the mock fixture", async () => {
    const jsx = await FeedSection({ items: [fetchItem], isMock: true });
    const { getByText } = render(jsx);
    expect(getByText(/Demo data/)).toBeTruthy();
  });
});
