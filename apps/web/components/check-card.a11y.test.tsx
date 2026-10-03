// @vitest-environment jsdom
import { describe, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { render } from "@testing-library/react";
import type { Check } from "@fact-checker-ke/core";
import { componentAxeOptions, expectNoAxeViolations } from "../test/axe-config";

vi.mock("next-intl/server", async () => {
  const mod = await import("../test/mock-next-intl-server");
  return mod.createNextIntlServerMock("en");
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
