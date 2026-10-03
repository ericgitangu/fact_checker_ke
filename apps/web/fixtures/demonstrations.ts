import type { Demonstration } from "@fact-checker-ke/core";

/**
 * Static fixture for the read-only /maandamano advisories page. No live
 * ingestion in this skeleton — swap for a real data source behind the same
 * Demonstration[] shape later. Deliberately ward/sub-county granularity
 * only, never coordinates (see packages/core/src/schemas/demonstration.ts).
 */
export const demonstrations: Demonstration[] = [
  {
    id: "d1a1f1a0-0000-4000-8000-000000000001",
    title: "Planned march along Moi Avenue",
    area: "Nairobi Central Ward",
    county: "Nairobi",
    status: "announced",
    date: "2026-10-10",
    summary:
      "Organisers announced a planned march; the county has not yet confirmed a route or permit status.",
    sourceUrl: "https://example.com/advisory/1",
    updatedAt: "2026-10-03T08:00:00.000Z",
  },
  {
    id: "d1a1f1a0-0000-4000-8000-000000000002",
    title: "Weekend gathering near Uhuru Park",
    area: "Nairobi Central Ward",
    county: "Nairobi",
    status: "confirmed",
    date: "2026-10-04",
    summary: "Confirmed by county authorities; expect road closures nearby.",
    sourceUrl: "https://example.com/advisory/2",
    updatedAt: "2026-10-02T12:00:00.000Z",
  },
];
