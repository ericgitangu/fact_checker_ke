import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement `window.matchMedia` (jsdom/jsdom#3522, still
// unresolved as of jsdom 25) — see apps/site/vitest.setup.ts for the full
// rationale. Mirrored here since this package's useTheme/WavingFlag hit
// the same gap under their own vitest+jsdom run.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
