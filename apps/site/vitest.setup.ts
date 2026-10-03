import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement `window.matchMedia` (tracked upstream as
// jsdom/jsdom#3522, still unresolved as of jsdom 25) — it leaves the
// property undefined rather than stubbing it, so any component that reads
// a media query (useTheme's system-theme check, WavingFlag's
// prefers-reduced-motion check) throws `TypeError: window.matchMedia is
// not a function` the moment it mounts in a test. Minimal stub: a static
// `matches: false` (never-matching) MediaQueryList with no-op listener
// methods, enough for components that only ever read `.matches` and
// (un)subscribe — not a full implementation of the media-query grammar.
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
