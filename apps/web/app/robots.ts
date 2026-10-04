import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

/**
 * Served at /robots.txt (Next Metadata file convention). Ported from the
 * retired apps/site (public/robots.txt), repointed at the single frontend's
 * origin and sitemap. Per-page noindex (terms/privacy) is handled by those
 * pages' own metadata, not here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
