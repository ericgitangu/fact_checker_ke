// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { cleanup, render } from "@testing-library/react";
import type { Check } from "@fact-checker-ke/core";
import { STANDING_CAVEAT_SHORT } from "@fact-checker-ke/core";
import { componentAxeOptions, expectNoAxeViolations } from "../test/axe-config";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
});

afterEach(() => {
  cleanup();
});

// Imported AFTER the mock so CheckCard/VerdictStamp pick up the mocked
// `next-intl/server` -- this is the real exported CheckCard component,
// not a reimplementation of its markup.
const { CheckCard } = await import("./check-card");

const baseClaim = {
  id: "11111111-1111-4111-8111-111111111111",
  checkId: "22222222-2222-4222-8222-222222222222",
  text: "Fuel prices will drop by half after the new refinery opens.",
  claimType: "checkable" as const,
  spanStart: 0,
  spanEnd: 54,
  namedPerson: false,
  attribution: "not_applicable" as const,
  createdAt: "2026-10-03T06:00:00.000Z",
};

const baseSource = {
  id: "33333333-3333-4333-8333-333333333333",
  url: "https://example.com/epra-pricing",
  title: "EPRA pricing guidance, Sept 2026",
  publisher: "Energy and Petroleum Regulatory Authority",
  credibilityTier: "tier1_primary" as const,
  retrievedAt: "2026-10-03T06:05:00.000Z",
};

const publishedCheck: Check = {
  id: "22222222-2222-4222-8222-222222222222",
  submissionId: "44444444-4444-4444-8444-444444444444",
  summary: '"Fuel prices will drop by half after the new refinery opens."',
  rating: "Misleading",
  isDraft: false,
  reviewedBy: "editor-1",
  createdAt: "2026-10-03T06:00:00.000Z",
  publishedAt: "2026-10-03T07:00:00.000Z",
  claims: [baseClaim],
  sources: [baseSource],
  calibratedConfidence: 0.91,
  whatWouldChangeThis: "A revised EPRA pricing circular superseding the Sept 2026 guidance.",
  context:
    "The claim predicts a 10% fuel-price drop from the new EPRA formula; the Sept 2026 guidance sets a cap, not a guaranteed cut, so the figure overstates it.",
  evidence: [{ sourceId: baseSource.id, quote: "EPRA pricing guidance, Sept 2026" }],
  riskTier: "A",
};

const draftCheck: Check = {
  ...publishedCheck,
  id: "55555555-5555-4555-8555-555555555555",
  rating: null,
  isDraft: true,
  reviewedBy: null,
  publishedAt: null,
};

describe("CheckCard a11y (AT-0028-2, check-detail surface)", () => {
  it("published verdict card has zero serious/critical axe violations", async () => {
    const jsx = await CheckCard({ check: publishedCheck });
    const { container } = render(jsx);
    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });

  it("draft (awaiting-editor) card has zero serious/critical axe violations", async () => {
    const jsx = await CheckCard({ check: draftCheck });
    const { container } = render(jsx);
    const results = await axe(container, componentAxeOptions);
    expectNoAxeViolations(results);
  });
});

/**
 * ADR-0033 AT-0033-1: the standing legal caveat renders on every
 * PUBLISHED check (any risk tier, fetch- or submission-sourced), and
 * never on a draft (which has nothing published yet to caveat).
 */
describe("CheckCard legal caveat gating (ADR-0033 AT-0033-1)", () => {
  it("renders the standing caveat on a published check", async () => {
    const jsx = await CheckCard({ check: publishedCheck });
    const { getByText } = render(jsx);
    expect(getByText(STANDING_CAVEAT_SHORT.heading)).toBeTruthy();
  });

  it("does NOT render the standing caveat on a draft (awaiting-editor) check", async () => {
    const jsx = await CheckCard({ check: draftCheck });
    const { queryByText } = render(jsx);
    expect(queryByText(STANDING_CAVEAT_SHORT.heading)).toBeNull();
  });
});
