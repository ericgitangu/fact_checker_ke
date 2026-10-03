import { createSerwistRoute } from "@serwist/turbopack";
import { precacheRevision } from "@/lib/precache-revision";

// Files whose content renders /~offline. Keep in sync when the offline page
// gains new imports (its layout and global styles are part of its output).
const OFFLINE_PAGE_INPUTS = ["app/~offline/page.tsx", "app/layout.tsx", "app/globals.css"] as const;

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [
      { url: "/~offline", revision: precacheRevision(OFFLINE_PAGE_INPUTS) },
    ],
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
  });
