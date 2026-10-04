import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

/**
 * Served at /sitemap.xml (Next Metadata file convention). Lists the
 * indexable public routes of the single frontend. /terms and /privacy are
 * deliberately excluded: they are noindex draft legal pages gated behind
 * ADVOCATE_SIGNOFF_COMPLETE (see app/{terms,privacy}/page.tsx), so listing
 * them would invite indexing of content we intentionally hold back.
 * Dynamic /checks/[id] and /submissions/[id] are omitted here (no static
 * enumeration without hitting services/api at build time); they are
 * reachable and individually indexable via the feed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = ["/", "/submit", "/feed", "/methodology", "/maandamano"];
  return paths.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path === "/feed" ? "daily" : "weekly",
    priority: path === "/" ? 1.0 : 0.7,
  }));
}
