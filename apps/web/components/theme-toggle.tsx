"use client";

import { SunIcon, MoonIcon, useTheme } from "@fact-checker-ke/brand";

/**
 * Light/dark theme toggle for the app header.
 *
 * This is the toggle that previously lived only in the (now-retired)
 * apps/site marketing SPA; apps/web is the sole frontend after the
 * consolidation (ADR-0010/0015 amendments, 2026-10-04), so it moves here
 * and sits on every page via <AppHeader>.
 *
 * brand's `useTheme` is the single source of this behaviour across the
 * codebase: it resolves the initial theme (persisted `fck-theme` choice,
 * else `prefers-color-scheme`), writes `<html data-theme>`, persists an
 * explicit choice, and follows the OS preference live while unset. The
 * pre-paint inline script in app/layout.tsx sets the same attribute before
 * first paint so there is no flash before this component hydrates.
 *
 * a11y: a real <button> with `role="switch"` + `aria-checked`, an
 * accessible label that names the action, and the global :focus-visible
 * ring for keyboard operation.
 */
export function ThemeToggle(): React.JSX.Element {
  const [theme, toggleTheme] = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {isDark ? <SunIcon size={17} /> : <MoonIcon size={17} />}
    </button>
  );
}
