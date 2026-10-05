import type { FeedItem } from "@fact-checker-ke/core";

/**
 * DEMO/SEED fixtures for the "what we're checking now" feed
 * (`components/feed-list.tsx`), used ONLY as a fallback when the real
 * `GET /v1/feed` isn't reachable — same convention as
 * `fixtures/editor-drafts.ts`'s `mockDraftChecks` for `/editor`. The
 * caller (`app/feed/page.tsx`, `components/feed-section.tsx`) tags the
 * rendered page `_mock: true` whenever this fixture is what's actually
 * shown, so a reader never mistakes dev/demo rows for live published
 * assessments.
 *
 * Realistic in register (Kenyan sources, plausible claims) but entirely
 * fabricated — not real adjudicated findings about any real person or
 * event. Deliberately mixes both ingestion engines (`fetch` and
 * `submission`), several ratings, and one claim-attributed named-person
 * "open question" (Tier C, mode (a)) that is framed as a question about
 * what was said, never an indictment — no real politician is named; the
 * attribution is role-based ("a senior MP") precisely so this fixture
 * can't be read as a real allegation about a real person.
 */
export const mockFeedItems: FeedItem[] = [
  {
    id: "f33d0000-0000-4000-8000-000000000001",
    claim: '"Fuel prices will drop by at least 10% this month following the new EPRA pricing formula."',
    rating: "MostlyTrue",
    calibratedConfidence: 0.88,
    ingestSource: "fetch",
    riskTier: "A",
    context:
      "The claim predicts a specific 10% fuel-price drop from the new EPRA formula. The formula sets a cap, not a guaranteed cut, so the figure overstates what the circular actually commits to.",
    whatWouldChangeThis: "A revised EPRA pricing circular superseding the one cited, or a landed-cost spike (FX/crude) after publication.",
    viralityScore: 14.2,
    publishedAt: "2026-09-29T07:12:00.000Z",
    sources: [
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a1",
        quote: "The maximum retail price for super petrol in Nairobi decreases by Ksh 8.20 per litre, effective midnight.",
        url: "https://example.com/epra-pricing-sept-2026",
        title: "EPRA monthly pump price guidance, Sept 2026",
        publisher: "Energy and Petroleum Regulatory Authority",
        credibilityTier: "tier1_primary",
      },
    ],
  },
  {
    id: "f33d0000-0000-4000-8000-000000000002",
    claim: '"A viral post claims this year\'s KCSE results were leaked two weeks before the official release."',
    rating: "False",
    calibratedConfidence: 0.93,
    ingestSource: "fetch",
    riskTier: "A",
    context:
      "The claim asserts KCSE results leaked two weeks early. No verified leak matching the official release has surfaced; viral 'leaks' each year routinely fail to match, which is the pattern here.",
    whatWouldChangeThis: "Verified leaked result slips matching the eventual official release, from a source KNEC itself confirms as genuine.",
    viralityScore: 18.7,
    publishedAt: "2026-09-28T15:40:00.000Z",
    sources: [
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a2",
        quote: "KNEC has not released any results ahead of the officially gazetted date and warns the public against fraudulent release claims.",
        url: "https://example.com/knec-results-advisory",
        title: "Public advisory on fraudulent results claims",
        publisher: "Kenya National Examinations Council",
        credibilityTier: "tier1_primary",
      },
    ],
  },
  {
    id: "f33d0000-0000-4000-8000-000000000003",
    claim: '"Someone submitted a clip saying youth unemployment has \'doubled\' in the last year."',
    rating: "Misleading",
    calibratedConfidence: 0.74,
    ingestSource: "submission",
    riskTier: "A",
    context:
      "The claim says youth unemployment 'doubled' in a year. KNBS labour-force figures show a rise, not a doubling; the word 'doubled' misstates the magnitude of a real trend.",
    whatWouldChangeThis: "A KNBS revision to the underlying labour force survey figures, or a differently-defined unemployment series showing the doubling.",
    viralityScore: null,
    publishedAt: "2026-09-27T09:05:00.000Z",
    sources: [
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a3",
        quote: "The youth (18–34) unemployment rate moved from 12.1% to 13.4% year-on-year — a rise, not a doubling.",
        url: "https://example.com/knbs-labour-survey-q2-2026",
        title: "Quarterly Labour Force Survey, Q2 2026",
        publisher: "Kenya National Bureau of Statistics",
        credibilityTier: "tier1_primary",
      },
    ],
  },
  {
    id: "f33d0000-0000-4000-8000-000000000004",
    claim:
      '"Did a senior MP really tell a rally that Treasury would waive all SME taxes next year?" — a claim-attributed open question, not a settled finding about what the MP believes or intends.',
    rating: "Unproven",
    calibratedConfidence: 0.52,
    ingestSource: "fetch",
    riskTier: "C",
    context:
      "The claim attributes a Treasury policy to a rally speech. No full transcript or on-record Treasury statement confirms the quoted policy, so the attribution is unverified.",
    whatWouldChangeThis: "A verified full transcript or video of the rally speech, or an on-record Treasury statement confirming or denying the policy.",
    viralityScore: 9.8,
    publishedAt: "2026-09-26T18:20:00.000Z",
    sources: [
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a4",
        quote: "Hansard records no Treasury motion or bill proposing a blanket SME tax waiver as of this sitting.",
        url: "https://example.com/hansard-national-assembly-sept-2026",
        title: "Hansard, National Assembly, Sept 2026",
        publisher: "Parliament of Kenya",
        credibilityTier: "tier1_primary",
      },
    ],
  },
  {
    id: "f33d0000-0000-4000-8000-000000000005",
    claim: '"The Central Bank held its base lending rate steady at this month\'s MPC meeting."',
    rating: "True",
    calibratedConfidence: 0.95,
    ingestSource: "fetch",
    riskTier: "A",
    context:
      "The claim states the CBK held its base rate steady at the latest MPC meeting. The official MPC communique confirms this, so the claim is accurate as stated.",
    whatWouldChangeThis: "A subsequent CBK communique revising the rate retroactively (not expected under current MPC procedure).",
    viralityScore: 16.1,
    publishedAt: "2026-09-25T12:00:00.000Z",
    sources: [
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a5",
        quote: "The Monetary Policy Committee retained the Central Bank Rate at 9.75%.",
        url: "https://example.com/cbk-mpc-communique-sept-2026",
        title: "MPC communique, Sept 2026",
        publisher: "Central Bank of Kenya",
        credibilityTier: "tier1_primary",
      },
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a6",
        quote: "Independent coverage confirms the rate held steady, in line with market expectations.",
        url: "https://example.com/pesacheck-cbk-rate-sept-2026",
        title: "CBK holds rate — what it means for borrowers",
        publisher: "PesaCheck",
        credibilityTier: "tier2_established_media",
      },
    ],
  },
  {
    id: "f33d0000-0000-4000-8000-000000000006",
    claim: '"A widely-shared graphic claims a specific county will be \'cut off the grid\' next week — no source, no date, no utility named."',
    rating: "NotCheckable",
    calibratedConfidence: 0.61,
    ingestSource: "submission",
    riskTier: "A",
    context:
      "The graphic claims a county will be 'cut off the grid' with no county, date, or utility named. With nothing attributable to check against a published schedule, it can't be substantiated.",
    whatWouldChangeThis: "A concrete, attributable claim (which county, which utility, which date) that can actually be checked against a published outage schedule.",
    viralityScore: null,
    publishedAt: "2026-09-24T21:15:00.000Z",
    sources: [
      {
        sourceId: "f33d0000-0000-4000-8000-0000000000a7",
        quote: "No scheduled county-wide outage matching this description appears on the published maintenance calendar.",
        url: "https://example.com/kplc-planned-outages-sept-2026",
        title: "Planned power interruptions, Sept 2026",
        publisher: "Kenya Power",
        credibilityTier: "tier1_primary",
      },
    ],
  },
];
