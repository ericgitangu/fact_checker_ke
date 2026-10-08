import type { CredibilityTier } from "@fact-checker-ke/core";

/**
 * ADR-0038 Wave 2 / ADR-0004 §5: host → credibility-tier lookup for a
 * crowdsourced source URL (`POST /v1/checks/:id/sources`). Only accepted
 * tier≤2 (authoritative) submissions count toward the re-verify threshold;
 * tier3/tier4/unknown are kept as community context, never auto-ingested as
 * evidence (ADR-0023/0036 citation-integrity: a submitted URL is untrusted
 * content, an agreement signal, not a verdict).
 *
 * TECH DEBT (stated, not buried): the authoritative registry is the PYTHON
 * pipeline's seed (`services/pipeline/app/data/credibility_registry.json`,
 * loaded by `app/registry/credibility.py#tier_for_url`). This TS copy is
 * VENDORED for the API tier (services/api must tier a submitted URL without a
 * round-trip to the pipeline, and apps/** / packages/** can't be edited this
 * wave). It MUST be kept in sync with that JSON by hand until the registry is
 * hoisted into a shared `packages/*` both services consume. The match logic
 * below mirrors the Python exactly (lowercase host, strip `www.`, then
 * `host === src || host.endsWith("." + src) || src in host`), so the two tiers
 * agree on what a domain scores. Last synced: registry version 1
 * (last_reviewed 2026-10-03).
 */
interface RegistryEntry {
  source: string;
  tier: CredibilityTier;
}

const REGISTRY: readonly RegistryEntry[] = [
  { source: "knbs.or.ke", tier: "tier1_primary" },
  { source: "kenyalaw.org", tier: "tier1_primary" },
  { source: "treasury.go.ke", tier: "tier1_primary" },
  { source: "centralbank.go.ke", tier: "tier1_primary" },
  { source: "iebc.or.ke", tier: "tier1_primary" },
  { source: "parliament.go.ke", tier: "tier1_primary" },
  { source: "pesacheck.org", tier: "tier2_established_media" },
  { source: "africacheck.org", tier: "tier2_established_media" },
  // Global authorities (synced with the pipeline JSON): health/science primaries
  // and international wire services — a fact-checker handling health misinfo and
  // global claims must tier these authoritative, not tier3.
  { source: "who.int", tier: "tier1_primary" },
  { source: "cdc.gov", tier: "tier1_primary" },
  { source: "nih.gov", tier: "tier1_primary" },
  { source: "un.org", tier: "tier1_primary" },
  { source: "reuters.com", tier: "tier2_established_media" },
  { source: "apnews.com", tier: "tier2_established_media" },
  { source: "afp.com", tier: "tier2_established_media" },
  { source: "bbc.com", tier: "tier2_established_media" },
  { source: "bbc.co.uk", tier: "tier2_established_media" },
  { source: "nation.africa", tier: "tier2_established_media" },
  { source: "standardmedia.co.ke", tier: "tier2_established_media" },
  { source: "citizen.digital", tier: "tier2_established_media" },
  { source: "the-star.co.ke", tier: "tier3_general" },
] as const;

const DEFAULT_TIER: CredibilityTier = "tier3_general";

/** The two tiers that count as "authoritative" for the re-verify threshold. */
export function isAuthoritativeTier(tier: CredibilityTier): boolean {
  return tier === "tier1_primary" || tier === "tier2_established_media";
}

/**
 * Best-effort credibility tier for a (resolved) source URL by matching its
 * host against the vendored registry. An unmatched/unparseable host degrades
 * to `tier3_general` (never dropped) — the same fail-soft as the Python
 * `tier_for_url` default. Mirrors that matcher's three host tests so a
 * subdomain of a registered source (e.g. `data.knbs.or.ke`) still tiers.
 */
export function tierForUrl(url: string): CredibilityTier {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return DEFAULT_TIER;
  }
  host = host.replace(/^www\./, "");
  if (!host) return DEFAULT_TIER;
  for (const entry of REGISTRY) {
    const src = entry.source.toLowerCase();
    if (host === src || host.endsWith("." + src) || host.includes(src)) {
      return entry.tier;
    }
  }
  return DEFAULT_TIER;
}
