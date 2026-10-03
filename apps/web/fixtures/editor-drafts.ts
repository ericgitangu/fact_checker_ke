import type { Check } from "@fact-checker-ke/core";

/**
 * Mock data for the /editor screen, used when `/v1/editor/drafts` isn't
 * reachable or doesn't exist yet (see lib/editor-client.ts — services/api
 * has NO editor routes as of this wave). The BFF route
 * (app/api/editor/drafts/route.ts) falls back to this fixture and tags
 * the response `_mock: true` so the client can show it's not live data.
 */
export const mockDraftChecks: Check[] = [
  {
    id: "e5a5f5a0-0000-4000-8000-000000000101",
    submissionId: "e5a5f5a0-0000-4000-8000-000000000001",
    summary: '"Fuel prices will drop by half after the new refinery opens."',
    rating: null,
    isDraft: true,
    reviewedBy: null,
    createdAt: "2026-10-03T06:00:00.000Z",
    publishedAt: null,
    claims: [
      {
        id: "e5a5f5a0-0000-4000-8000-000000000102",
        checkId: "e5a5f5a0-0000-4000-8000-000000000101",
        text: "Fuel prices will drop by half after the new refinery opens.",
        claimType: "checkable",
        spanStart: 0,
        spanEnd: 54,
        namedPerson: false,
        attribution: "not_applicable",
        createdAt: "2026-10-03T06:00:00.000Z",
      },
    ],
    sources: [
      {
        id: "e5a5f5a0-0000-4000-8000-000000000103",
        title: "EPRA pricing guidance, Sept 2026",
        url: "https://example.com/epra-pricing",
        publisher: "Energy and Petroleum Regulatory Authority",
        credibilityTier: "tier1_primary",
        retrievedAt: "2026-10-03T06:05:00.000Z",
      },
    ],
  },
  {
    id: "e5a5f5a0-0000-4000-8000-000000000201",
    submissionId: "e5a5f5a0-0000-4000-8000-000000000002",
    summary: '"A named MP said the budget was passed unanimously."',
    rating: null,
    isDraft: true,
    reviewedBy: null,
    createdAt: "2026-10-03T07:30:00.000Z",
    publishedAt: null,
    claims: [
      {
        id: "e5a5f5a0-0000-4000-8000-000000000202",
        checkId: "e5a5f5a0-0000-4000-8000-000000000201",
        text: "The budget was passed unanimously.",
        claimType: "checkable",
        spanStart: 0,
        spanEnd: 35,
        namedPerson: false,
        attribution: "not_applicable",
        createdAt: "2026-10-03T07:30:00.000Z",
      },
    ],
    sources: [
      {
        id: "e5a5f5a0-0000-4000-8000-000000000203",
        title: "Hansard, National Assembly, Sept 2026",
        url: "https://example.com/hansard",
        publisher: "Parliament of Kenya",
        credibilityTier: "tier1_primary",
        retrievedAt: "2026-10-03T07:35:00.000Z",
      },
    ],
  },
];
