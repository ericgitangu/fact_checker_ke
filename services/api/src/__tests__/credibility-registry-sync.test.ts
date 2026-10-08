import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { tierForUrl } from "../lib/credibility-registry.js";

/**
 * ADR-0038 Wave 2 anti-drift guard: the API's host→tier registry
 * (lib/credibility-registry.ts) is a VENDORED copy of the pipeline's seed
 * (services/pipeline/app/data/credibility_registry.json) — the API tiers a
 * crowdsourced URL without a round-trip to the pipeline. This test fails if the
 * two diverge, so the hand-sync can't rot silently until the registry is hoisted
 * into a shared package.
 */
const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, "../../../pipeline/app/data/credibility_registry.json");

interface PipelineEntry {
  source: string;
  tier: string;
}

describe("credibility registry sync (API vendored copy vs pipeline JSON)", () => {
  const json = JSON.parse(readFileSync(registryPath, "utf8")) as { sources: PipelineEntry[] };

  it("loads the pipeline registry", () => {
    expect(json.sources.length).toBeGreaterThan(0);
  });

  it("tiers every pipeline-registered domain identically to the pipeline JSON", () => {
    const mismatches: string[] = [];
    for (const entry of json.sources) {
      const apiTier = tierForUrl(`https://${entry.source}/some/path`);
      if (apiTier !== entry.tier) {
        mismatches.push(`${entry.source}: pipeline=${entry.tier} api=${apiTier ?? "null"}`);
      }
    }
    expect(mismatches, `registry drift — re-sync lib/credibility-registry.ts:\n${mismatches.join("\n")}`).toEqual([]);
  });
});
